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
#   Jari Savolainen <ext-jari.a.savolainen@nokia.com>

#
# General notes:
#
#   * Data is kept in perl Storable format files under EXTENSION_DIR
#     (nominally, bugzila_root/data/extensions/Dashboard).
#
#   * EXTENSION_DIR contains a subdirectory for each user, with the directory
#     name being the user's integer ID. The subdirectory with the ID "0" is
#     used for storing shared overlay files.
#
#   * Within each user directory, there is one 'preferences' file, zero or more
#     '*.widget' files, and possibly one 'overlay' file, as documented below.
#
#
# Preferences file keys:
#
#       columns:
#           Integer columns configured (default: COLUMNS_DEFAULT).
#       column(0..columns):
#           Integer column width in percent.
#
#
# Widget file keys:
#
#       id:
#           Integer widget ID
#       col:
#           Integer 0..cols widget column number.
#       pos:
#           Integer 0..rows widget position in column.
#       height:
#           Integer widget height in pixels.
#       type:
#           String widget type, one of 'url', 'rss', 'mybugs', 'xeyes'.
#       resized:
#           Bool 0..1, force widget resize on next reload.
#       minimized:
#           Bool 0..1, widget content is hidden.
#       refresh:
#           Integer, unknown.
#
#
# Overlay file keys:
#
#       shared:
#           Bool 0..1, widget is shared between all users.
#       name:
#           String overlay short name.
#       description:
#           String overlay description.
#       owner:
#           Integer owner user ID.
#       created:
#           Integer seconds since UNIX epoch creation time.
#       username:
#           String username for RSS/mybugs widget, empty for shared.
#       password:
#           String password for RSS/mybugs widget, empty for shared.
#

package Bugzilla::Extension::Dashboard::Util;

use strict;
use warnings;

use Exporter 'import';
our @EXPORT_OK = qw(
    cgi_no_cache
    clear_user_workspace
    dir_glob
    get_overlay_dir
    get_user_dir
    get_user_overlay_dir
    get_user_prefs
    get_user_widget
    get_user_widgets
    get_user_overlays
    load_user_overlay
    make_path
    scrub_string
    set_user_prefs
    to_bool
    to_int
);

use Data::Dumper;

use File::Basename;
use File::Copy;
use File::Path;
use File::Spec;
use POSIX qw(strftime isdigit);
use Storable qw(store retrieve);

use Bugzilla::Constants;
use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::User;
use Bugzilla::Util;

sub cgi_no_cache {
    my $headers = {
        -expires       => 'Sat, 26 Jul 1997 05:00:00 GMT',
        -Last_Modified => strftime('%a, %d %b %Y %H:%M:%S GMT', gmtime),
        -Pragma        => 'no-cache',
        -Cache_Control => join(
            ', ', qw(
              private no-cache no-store must-revalidate max-age=0
              pre-check=0 post-check=0)
        )
    };

    foreach my $key (%$headers) {
        print Bugzilla->cgi->header($key, $headers->{$key});
    }
}

sub make_path {
    my ($path) = @_;

    mkpath(
           $path,
           {
              verbose => 0,
              mode    => 0755,
              error   => \my $err
           }
          );

    if (@$err) {
        for my $diag (@$err) {
            my ($file, $message) = each %$diag;
            print "Problem making $file: $message\n";
        }
        die("Couldn't create $path");
    }
}

sub dir_glob {
    my @out;
    foreach my $path (glob File::Spec->catfile(@_)) {
        trick_taint $path;
        push @out, $path;
    }
    return @out;
}

sub get_extension_dir {
    return File::Spec->catdir(bz_locations()->{'datadir'}, EXTENSION_DIR);
}

sub get_user_dir {
    my ($user_id) = @_;
    $user_id = Bugzilla->user->id if !defined($user_id);
    trick_taint $user_id;
    return File::Spec->catdir(get_extension_dir(), $user_id);
}

sub get_user_overlay_dir {
    my ($user_id) = @_;
    return File::Spec->catdir(get_user_dir($user_id), 'overlay');
}

sub get_overlay_dir {
    my ($user_id, $overlay_id) = @_;
    return File::Spec->catdir(get_user_overlay_dir($user_id), $overlay_id);
}

sub get_overlay {
    my ($user_id, $overlay_id) = @_;
    if(!defined $user_id) {
        $user_id = Bugzilla->user->id;
    }

    my $dir = get_overlay_dir($user_id, $overlay_id);
    my $active  = File::Spec->catfile($dir, 'overlay');
    my $pending = File::Spec->catfile($dir, 'overlay.pending');

    foreach my $path (($active, $pending)) {
        if (-f $path) {
            my $overlay = retrieve($path);
            $overlay->{"overlay_id"} = int(basename dirname $path);
            $overlay->{"user_id"}    = $user_id;
            $overlay->{"user_login"} = user_id_to_login($overlay->{"owner"});
            $overlay->{"pending"}    = int($path eq $pending);
            return $overlay;
        }
    }
}

sub get_user_overlays {
    my ($user_id) = @_;
    my $overlay_dir = get_user_overlay_dir($user_id);

    my @overlays;
    foreach my $dir (dir_glob($overlay_dir, '*')) {
        my $overlay = get_overlay($user_id, basename $dir);
        if($overlay) {
            push @overlays, $overlay;
        }
    }

    return @overlays;
}

sub get_shared_overlay_dir {
    return get_user_overlay_dir(0);
}

sub get_user_pref_path {
    my ($user_id) = @_;
    return File::Spec->catfile(get_user_dir($user_id), 'preferences');
}

sub get_user_prefs {
    my ($user_id) = @_;
    my $path = get_user_pref_path($user_id);
    my $prefs;

    if (-f $path) {
        $prefs = retrieve($path);
        $prefs->{widgets} = [ get_user_widgets($user_id) ];
    }
    else {
        # create default preferences
        $prefs = {
                   widgets => [],
                   columns => COLUMNS_DEFAULT
                 };

        for (my $i = 0 ; $i < COLUMNS_DEFAULT ; $i++) {
            $prefs->{ "column" . $i } = int(100 / COLUMNS_DEFAULT);
        }
    }

    return $prefs;
}

sub set_user_prefs {
    my ($user_id, $prefs) = @_;
    my $path = get_user_pref_path($user_id);

    # new user, create prefs folder
    if (!-d dirname $path) {
        make_path dirname $path;
    }

    set_user_widgets($user_id, $prefs->{widgets});
    delete $prefs->{widgets};

    store $prefs, $path;
}

sub get_user_widgets {
    my $user_dir = get_user_dir(@_);
    return map { retrieve($_) } dir_glob($user_dir, '*.widget');
}

sub set_user_widgets {
    my ($user_id, $widgets) = @_;

    my $paths;
    foreach my $widget (@{$widgets}) {
        my $path = get_widget_path($user_id, $widget->{id});
        store $widget, $path;
        $paths->{$path} = 1;
    }

    my @old = dir_glob(get_user_dir($user_id), "*.widget");
    unlink grep { !$paths->{$_} } @old;
}

sub get_widget_path {
    my ($user_id, $widget_id) = @_;
    my $user_dir = get_user_dir($user_id);
    return File::Spec->catfile($user_dir, $widget_id . '.widget');
}

sub get_user_widget {
    my ($user_id, $widget_id) = @_;
    my $path = get_widget_path($user_id, $widget_id);
    if (-f $path) {
        return retrieve($path);
    }
}

sub to_int {
    my ($s) = @_;
    detaint_natural($s);
    return $s || 0;
}

sub to_bool {
    my ($s) = @_;
    return (($s || '') eq 'true') ? 1 : 0;
}

sub scrub_string {
    my ($s, $default) = @_;
    if ($s) {
        my $scrubber = HTML::Scrubber->new;
        $scrubber->default(0);
        return $scrubber->scrub($s);
    }
    return $default || ' ';
}


# Clear the user's workspace and load a new overlay.
sub clear_user_workspace {
    my ($user_id) = @_;

    my $prefs = get_user_prefs($user_id);
    for (my $i = 0; $i <  $prefs->{columns}; $i++) {
        delete $prefs->{"column$i"};
    }

    $prefs->{widgets} = [];
    $prefs->{columns} = 3;
    for (my $i = 0; $i <  $prefs->{columns}; $i++) {
        $prefs->{"column$i"} = 33; # percent
    }

    set_user_prefs($user_id, $prefs);
}


# Clear the user's workspace and load a new overlay.
sub load_user_overlay {
    my ($user_id, $overlay_user_id, $overlay_id) = @_;
    clear_user_workspace $user_id;

    my $source_dir = get_overlay_dir($overlay_user_id, $overlay_id);
    my $user_dir = get_user_dir($user_id);

    foreach my $path (dir_glob($source_dir, '*')) {
        if(-f $path && basename($path) !~ /^overlay/) {
            copy($path, $user_dir)
              or die "Copy failed: $!";
        }
    }
}

1;
