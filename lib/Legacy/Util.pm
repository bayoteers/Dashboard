# -*- Mode: perl; indent-tabs-mode: nil -*-
#
# The contents of this file are subject to the Mozilla Public
# License Version 1.1 (the "License"); you may not use this file
# except in compliance with the License. You may obtain a copy of
# the License at http://www.mozilla.org/MPL/
#
# Software distributed under the License is distributed on an "AS
# IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or
# implied. See the License for the specific language governing
# rights and limitations under the License.
#
# The Original Code is the Unified Dashboard Bugzilla Extension.
#
# The Initial Developer of the Original Code is "Nokia Corporation"
# Portions created by the Initial Developer are Copyright (C) 2010 the
# Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   David Wilson <ext-david.3.wilson@nokia.com>
#   Jari Savolainen <ext-jari.a.savolainen@nokia.com>
#

package Bugzilla::Extension::Dashboard::Legacy::Util;

use strict;
use warnings;

use Exporter 'import';
our @EXPORT = qw(
    dir_glob
    first_free_id
    get_mtime
    get_overlay_dir
    get_overlays_dir
    merge
    migrate_workspace
    overlay_from_dir
    overlays_for_user
    overlay_to_dir
    trim_workspace_overlays
);

use Data::Dumper;
use File::Basename;
use File::Copy qw(move);
use File::Path qw(mkpath remove_tree);
use File::Spec;
use List::Util qw(sum);
use POSIX qw(getpid strftime);
use Storable qw(store retrieve);

use Bugzilla::Constants;
use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::Legacy::Schema;
use Bugzilla::User;
use Bugzilla::Util;


#
# Data helper functions.
#

# Given a list of hashrefs, return a new hashref which is the result of
# assigning the elements from each hash in order to an empty hash. Skips list
# items that aren't hashrefs.
sub merge {
    my $out = {};
    for my $hash (@_) {
        if(! UNIVERSAL::isa($hash, 'HASH')) {
            next;
        }

        while(my ($key, $value) = each(%$hash)) {
            $out->{$key} = $value;
        }
    }
    return $out;
};


#
# Filesystem helper functions.
#


# Create a directory if it doesn't already exist.
sub make_path {
    my ($path) = @_;

    if(-d $path) {
        return;
    }

    mkpath($path, {
        verbose => 0,
        mode    => 0755,
        error   => \my $err
    });

    if (@$err) {
        for my $diag (@$err) {
            my ($file, $message) = each %$diag;
            print "Problem making $file: $message\n";
        }
        die("Couldn't create $path");
    }
}


# Glob some pattern and detaint each returned result.
sub dir_glob {
    my @out;
    foreach my $path (glob File::Spec->catfile(@_)) {
        trick_taint $path;
        push @out, $path;
    }
    return @out;
}


# Return the modification time of a path in seconds since epoch.
sub get_mtime {
    my ($path) = @_;
    my @st = lstat $path;
    return $st[9];
}


# Find an unused overlay ID we can use to store the loaded page's unsaved
# changes to. When the user explicitly saves the workspace, this overlay is
# destroyed.
sub first_free_id {
    my ($dir) = @_;
    my $dest_dir;
    my $found = 0;
    my $id;

    make_path($dir);

    do {
        $id = time() | getpid();
        $dest_dir = File::Spec->catdir($dir, $id);
        $found = mkdir($dest_dir);
        if(! $found) {
            sleep 1;
        }
    } until($found);

    return int($id);
}


# Return a user's data directory.
sub get_user_dir {
    my ($user_id) = @_;
    $user_id = Bugzilla->user->id if !defined($user_id);
    trick_taint $user_id;

    my $ext_dir = File::Spec->catdir(bz_locations()->{datadir},
        'extensions/Dashboard');
    return File::Spec->catdir($ext_dir, $user_id);
}


# Return the directory containing the overlays for the given user.
sub get_overlays_dir {
    my ($user_id) = @_;
    return File::Spec->catdir(get_user_dir($user_id), 'overlay');
}


# Return the directory containing a particular overlay.
sub get_overlay_dir {
    my ($user_id, $overlay_id) = @_;
    return File::Spec->catdir(get_overlays_dir($user_id), $overlay_id);
}


#
# Widget IO functions.
#


# Write a list of widgets to the given directory, then delete any other widget
# files from the directory that weren't in the list.
sub widgets_to_dir {
    my ($dir, $widgets) = @_;

    my $paths;
    foreach my $widget (@{$widgets}) {
        my $path = File::Spec->catfile($dir, $widget->{id} . '.widget');
        store $widget, $path;
        $paths->{$path} = 1;
    }

    my @old = dir_glob($dir, '*.widget');
    unlink grep { !$paths->{$_} } @old;
}


# Return widgets from the given directory as an arrayref.
sub widgets_from_dir {
    my ($dir) = @_;
    my @widgets = map { retrieve $_; } dir_glob($dir, '*.widget');
    return [ map { parse(WIDGET_DEFS, $_) } @widgets ];
}


# Given an array ref of widget hashrefs, remove any private fields present.
sub blank_private_fields {
    my ($defs, $widgets) = @_;

    my @private;
    while(my ($field, $def) = each(%$defs)) {
        push @private, $field if $def->{private};
    }

    map { delete @$_{@private} } @$widgets;
}


#
# Overlay IO functions.
#


# Read an overlay from a directory.
sub overlay_from_dir {
    my ($user_id, $dir) = @_;

    my $path = File::Spec->catfile($dir, 'overlay');
    if(! -f $path) {
        die "Cannot load, overlay file missing.";
    }
    my $overlay = retrieve($path);

    $path = File::Spec->catfile($dir, 'preferences');
    if(-f $path) {
        $overlay = merge($overlay, retrieve($path));
    }

    normalize_columns($overlay);
    $overlay->{widgets} = widgets_from_dir($dir);

    if($user_id != $overlay->{user_id}) {
        blank_private_fields(WIDGET_DEFS, $overlay->{widgets});
    }

    return $overlay;
};


# Write an overlay to a directory.
sub overlay_to_dir {
    my ($dir, $overlay) = @_;

    my $tmp = $dir . '.tmp';
    if(-d $tmp) {
        remove_tree $tmp;
    }
    make_path $tmp;

    normalize_columns($overlay);
    $overlay = parse(OVERLAY_DEFS, $overlay);
    $overlay->{modified} = time;

    my $path = File::Spec->catfile($tmp, 'overlay');
    if($overlay->{pending}) {
        $path .= '.pending';
    }

    # Widgets are stored separately for now; copy $prefs to preserve the hash
    # for any callers.
    widgets_to_dir($tmp, $overlay->{widgets});
    my $copy = merge($overlay);
    delete $copy->{widgets};
    store $copy, $path;

    # Everything written, now drop any old dir and replace with the new one.
    if(-d $dir) {
        remove_tree $dir;
    }
    move $tmp, $dir;
};


# Return a list of all overlays for a user.
sub overlays_for_user {
    my ($user_id) = @_;
    $user_id = Bugzilla->user->id if !defined($user_id);

    my @overlays;
    foreach my $dir (dir_glob(get_overlays_dir($user_id), '*')) {
        my $active  = File::Spec->catfile($dir, 'overlay');
        my $prefs = File::Spec->catfile($dir, 'preferences');
        my $pending = File::Spec->catfile($dir, 'overlay.pending');

        my $base = {};
        if(-f $prefs) {
            $base = retrieve($prefs);
        }

        foreach my $path (($active, $pending)) {
            next if !-f $path;
            my $overlay = merge($base, retrieve($path));
            $overlay->{id} = int(basename dirname $path);
            $overlay->{user_id} = $user_id;
            $overlay->{user_login} = user_id_to_login($overlay->{owner});
            $overlay->{pending} = int($path eq $pending);
            if(! $overlay->{modified}) {
                $overlay->{modified} = get_mtime $path;
            }
            normalize_columns($overlay);
            push @overlays, parse(OVERLAY_DEFS, $overlay);
        }
    }

    return @overlays;
}


# Migrate an old style user workspace to a private overlay, if necessary.
sub migrate_workspace {
    my ($user_id) = @_;
    $user_id = Bugzilla->user->id if !defined($user_id);

    my $user_dir = get_user_dir($user_id);
    my $prefs_path = File::Spec->catfile($user_dir, 'preferences');
    if(! -f $prefs_path) {
        return;
    }

    my $mtime = get_mtime $prefs_path;
    my $time_str = strftime('%a, %Y-%m-%d %H:%M:%S', gmtime $mtime);

    my $prefs = retrieve($prefs_path)
        or die $!;
    normalize_columns($prefs);

    my $overlay = parse(OVERLAY_DEFS, merge($prefs, {
        created => $mtime,
        modified => $mtime,
        description => 'Last active workspace from old Dashboard',
        name => 'Workspace from ' . $time_str,
        owner => $user_id,
        widgets => widgets_from_dir($user_dir),
        workspace => 1,
    }));

    # Must remove 'overlay' file first as it shadows overlay subdirectory.
    my $overlay_path = File::Spec->catfile($user_dir, 'overlay');
    unlink $overlay_path if(-f $overlay_path);

    my $overlay_dir = get_overlay_dir($user_id, $mtime);
    overlay_to_dir $overlay_dir, $overlay;
    unlink $prefs_path, grep { -f $_ } $user_dir;
}


# Convert old Dashboard's list of column keys to a new style columns structure,
# if necessary. Then normalize the column widths.
sub normalize_columns {
    my ($prefs) = @_;

    if(! UNIVERSAL::isa($prefs->{columns}, "ARRAY")) {
        my @keys = grep /^column[0-9]/, sort keys %{$prefs};
        $prefs->{columns} = [ map { { width => $prefs->{$_} } } @keys ];
        map { delete $prefs->{$_} } @keys;
    }

    if(! @{$prefs->{columns}}) {
        $prefs->{columns} = [
            { width => 33 },
            { width => 33 },
            { width => 33 }
        ];
    }

    # If column totals don't add up to 100%, spread the difference out.
    my $total = sum map { $_->{width} } @{$prefs->{columns}};
    my $delta = int((100 - $total) / @{$prefs->{columns}});
    map { $_->{width} += $delta } @{$prefs->{columns}};
}


# Remove all but the newest <Params.dashboard_max_workspaces> 'workspace'
# overlays from a user's overlay directory.
sub trim_workspace_overlays {
    my @overlays = overlays_for_user(@_);
    my @workspaces = grep { $_->{workspace} == 1 } @overlays;
    @workspaces = sort { $b->{modified} <=> $a->{modified} } @workspaces;

    while(@workspaces > Bugzilla->params->{'dashboard_max_workspaces'}) {
        my $info = pop @workspaces;
        my $overlay = Bugzilla::Extension::Dashboard::Overlay->from_store(
            $info->{user_id}, $info->{id});
        $overlay->delete();
    }
}


1;
