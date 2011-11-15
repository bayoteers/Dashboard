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
    get_shared_overlay_dir
    WIDGET_FIELD_DEFS
    COLUMN_FIELD_DEFS
    OVERLAY_FIELD_DEFS
    get_user_dir
    get_user_overlay_dir
    get_user_overlays
    get_user_prefs
    merge
    get_user_widget
    get_user_widgets
    fields_from_params
    fixup_types
    validate_fields
    get_widget_path
    is_valid_widget_type
    load_user_overlay
    make_path
    scrub_string
    set_user_prefs
    set_user_widgets
    to_bool
    to_color
    to_int
);

use Data::Dumper;
use List::Util qw(sum);

use File::Basename;
use File::Copy;
use File::Path;
use File::Spec;
use POSIX qw(floor strftime isdigit);
use Storable qw(store retrieve);

use Bugzilla::Constants;
use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::User;
use Bugzilla::Util;


use constant WIDGET_FIELD_DEFS => {
    color => { type => 'color', required => 1, default => 'gray' },
    col => { type => 'int', required => 1 },
    height => { type => 'int' },
    id => { type => 'int', required => 1, min => 1 },
    minimized => { type => 'bool' },
    password => { type => 'text' },
    pos => { type => 'int', required => 1 },
    refresh => { type => 'int', default => 600, required => 1 },
    title => { type => 'text', required => 1 },
    type => { type => 'text', required => 1, choices => [ WIDGET_TYPES ]},
    URL => { type => 'text' },
    username => { type => 'text' },
    width => { type => 'int' },
};

use constant OVERLAY_FIELD_DEFS => {
    description => { type => 'text', required => 1, default => '' },
    name => { type => 'text', required => 1, min_length => 4 },
    shared => { type => 'bool', default => 0, required => 1 },
};

use constant COLUMN_FIELD_DEFS => {
    width => { type => 'int', required => 1 }
};

use constant TYPE_CONVERTER_MAP => {
    int => \&to_int,
    bool => \&to_bool,
    text => \&scrub_string,
    color => \&to_color
};


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


sub fields_from_params {
    my ($defs, $params) = @_;
    my $fields;

    while(my ($field, $value) = each(%$params)) {
        my $def = $defs->{$field};
        if(defined($def)) {
            my $converter = TYPE_CONVERTER_MAP->{$def->{type}};
            $fields->{$field} = &$converter($value);
        }
    }

    return $fields;
}


sub validate_fields {
    my ($defs, $fields, $check_required) = @_;

    while(my ($field, $def) = each(%$defs)) {
        my $value = $fields->{$field};

        if(defined($def->{min}) && $value < $def->{min}) {
            my $min = $def->{min};
            die "Field '$field' must be at least $min.";
        } elsif(defined($def->{min_length}) && length($value) < $def->{min_length}) {
            my $min = $def->{min_length};
            die "Field '$field' must be at least $min long.";
        } elsif(defined($def->{default}) && !defined($value)) {
            $fields->{$field} = $def->{default};
        } elsif($def->{required} && $check_required && !defined($value)) {
            die 'Missing required field: ' . $field;
        } elsif($def->{choices} && defined($value)
                && !grep($_ eq $value, @{$def->{choices}})) {
            my $choices = join(', ', @{$def->{choices}});
            die "Field $field invalid value '$value'; ".
                "must be one of $choices";
        }
    }
}


sub fixup_types {
    my ($defs, $fields) = @_;
    while(my ($field, $def) = each(%$defs)) {
        my $converter = TYPE_CONVERTER_MAP->{$def->{type}};
        my $value = $fields->{$field};
        $fields->{$field} = &$converter($value);
    }
}

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
            $overlay->{"id"} = int(basename dirname $path);
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

# create default preferences
sub make_empty_prefs {
    my $prefs = {
        widgets => [],
        columns => []
    };

    foreach(1..COLUMNS_DEFAULT) {
        my $column = { width => int(100 / COLUMNS_DEFAULT) };
        push @{$prefs->{columns}}, $column;
    }

    return $prefs;
}

sub get_user_prefs {
    my ($user_id) = @_;
    my $path = get_user_pref_path($user_id);
    my $prefs;

    if (-f $path) {
        $prefs = retrieve($path);
        $prefs->{widgets} = [ get_user_widgets($user_id) ];
    } else {
        $prefs = make_empty_prefs();
    }

    normalize_columns($prefs);
    return $prefs;
}

# The new-style column structure is an array named "columns", with each element
# a hashref with a single key, "width". The old structure was the keys
# column0..columnN, with the width as their value, along with a "columns"
# integer, which was never set correctly. If the old structure is detected
# here, convert it to the new structure.
sub normalize_columns {
    my ($prefs) = @_;

    if(! UNIVERSAL::isa($prefs->{columns}, "ARRAY")) {
        my @keys = sort grep { /^column[0-9]/ } keys %{$prefs};
        $prefs->{columns} = [ map { { width => $prefs->{$_} } } @keys ];
        map { delete $prefs->{$_} } @keys;
    }

    # If column totals don't add up to 100%, spread the difference out.
    my $total = sum map { $_->{width} } @{$prefs->{columns}};
    my $delta = int((100 - $total) / @{$prefs->{columns}});
    map { $_->{width} += $delta } @{$prefs->{columns}};
}


sub set_user_prefs {
    my ($user_id, $prefs) = @_;
    my $path = get_user_pref_path($user_id);

    # new user, create prefs folder
    if (!-d dirname $path) {
        make_path dirname $path;
    }

    normalize_columns($prefs);
    set_user_widgets($user_id, $prefs->{widgets});

    # Widgets are stored separately for now; copy $prefs to preserve the hash
    # for any callers.
    my $to_save = merge($prefs);
    delete $to_save->{widgets};
    store $to_save, $path;
}

sub get_user_widgets {
    my ($user_id) = @_;
    my @paths = dir_glob(get_user_dir($user_id), '*.widget');
    my @widgets = map { retrieve $_; } @paths;
    map { fixup_types WIDGET_FIELD_DEFS, $_ } @widgets;
    return @widgets;
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
    if (!-f $path) {
        return undef;
    }

    my $widget = retrieve($path);
    fixup_types WIDGET_FIELD_DEFS, $widget;
    return $widget;
}

sub to_bool {
    my ($s) = @_;
    $s ||= '';
    return int($s eq 'true' || ($s =~ /\d+/ && $s == 1));
}

sub to_color {
    my ($s) = @_;
    $s ||= '';

    if($s =~ /^(?:color-)?(gray|yellow|red|blue|white|orange|green)$/) {
        return $1;
    }

    return 'gray';
    #ThrowUserError('dashboard_invalid_color');
}

sub to_int {
    my ($s) = @_;
    detaint_signed($s);
    return int($s || 0);
}

sub is_valid_widget_type {
    my ($s) = @_;
    $s ||= '';
    return grep($_ eq $s, WIDGET_TYPES) ? 1 : 0;
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
    set_user_prefs($user_id, make_empty_prefs());
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
