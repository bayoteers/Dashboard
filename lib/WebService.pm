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
# The Original Code is the Bugzilla Bug Tracking System.
#
# The Initial Developer of the Original Code is Everything Solved, Inc.
# Portions created by Everything Solved, Inc. are Copyright (C) 2007
# Everything Solved, Inc. All Rights Reserved.

package Bugzilla::Extension::Dashboard::WebService;

use strict;
use warnings;

use base qw(Bugzilla::WebService);

use Data::Dumper;
use Storable;

use File::Basename;
use File::Copy;
use File::Path qw(make_path remove_tree);
use File::Spec;
use List::Util;

use Bugzilla::Util;
use Bugzilla::Error;

use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::Util qw(
    clear_user_workspace
    dir_glob
    get_overlay_dir
    get_shared_overlay_dir
    get_user_dir
    get_user_overlay_dir
    get_user_overlays
    get_user_prefs
    get_user_widgets
    get_widget_path
    is_valid_widget_type
    load_user_overlay
    scrub_string
    set_user_prefs
    set_user_widgets
    to_bool
    to_color
    to_int
);


sub require_account {
    if(! Bugzilla->user->id) {
        die 'You must provide Bugzilla_login and Bugzilla_password parameters.';
    }
}


my $WIDGET_FIELD_DEFS = {
    collapsible => { type => 'bool' },
    color => { type => 'color', required => 1, default => 'gray' },
    col => { type => 'int', required => 1 },
    controls => { type => 'bool', default => 1, required => 1 },
    editable => { type => 'bool', default => 1, required => 1 },
    height => { type => 'int' },
    id => { type => 'int', required => 1 },
    maximizable => { type => 'bool' },
    minimized => { type => 'bool' },
    movable => { type => 'bool' },
    password => { type => 'text' },
    pos => { type => 'int', required => 1 },
    refreshable => { type => 'bool', default => 1, required => 1 },
    refresh => { type => 'int', default => 600, required => 1 },
    removable => { type => 'bool' },
    resizable => { type => 'bool', default => 1, required => 1 },
    resized => { type => 'bool' },
    title => { type => 'text', required => 1 },
    type => { type => 'text', required => 1, choices => [ WIDGET_TYPES ]},
    URL => { type => 'text' },
    username => { type => 'text' },
};

my $OVERLAY_FIELD_DEFS = {
    description => { type => 'text', required => 1, default => '' },
    name => { type => 'text', required => 1, min_length => 4 },
    shared => { type => 'bool', default => 0, required => 1 },
};

my $TYPE_CONVERTER_MAP = {
    int => \&to_int,
    bool => \&to_bool,
    text => \&scrub_string,
    color => \&to_color
};


sub _fields_from_params {
    my ($defs, $params) = @_;
    my $fields;

    while(my ($field, $value) = each(%$params)) {
        my $def = $defs->{$field};

        if($field =~ /^Bugzilla_/) {
            # Skip authentication fields; appears to only be required on older
            # versions of Bugzilla.
            next;
        } elsif(! defined($def)) {
            die 'Invalid field name: ' . $field;
        }

        my $converter = $TYPE_CONVERTER_MAP->{$def->{type}};
        $fields->{$field} = &$converter($value);
    }

    return $fields;
}


sub _validate_fields {
    my ($defs, $fields, $check_required) = @_;

    while(my ($field, $def) = each(%$defs)) {
        my $value = $fields->{$field};

        if(defined($def->{min_length}) && length($value) < $def->{min_length}) {
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


# create new widget and store all required preferences
sub new_widget {
    require_account;
    my ($self, $params) = @_;

    my $widget_id = to_int($params->{'id'});
    if ($widget_id <= 0) {
        ThrowUserError('dashboard_illegal_id');
    }

    # if widget can be created, get required prefences, store them and tell
    # jquery to save any extra preferences the widget has
    my @widgets = get_user_widgets();
    if(@widgets >= WIDGETS_MAX) {
        ThrowUserError('dashboard_max_widgets');
    }

    my $widget = _fields_from_params($WIDGET_FIELD_DEFS, $params);
    _validate_fields($WIDGET_FIELD_DEFS, $widget, 1);

    # Force the widget to be resized on load.
    $widget->{resized} = 1;

    push @widgets, $widget;
    set_user_widgets(undef, \@widgets);
    return $widget;
}

# get and store all extended widget preferences
sub save_widget {
    require_account;
    my ($self, $params) = @_;

    my $widget_id = to_int($params->{'id'});

    my $path = get_widget_path(undef, $widget_id);
    if ($widget_id <= 0 || !-e $path) {
        ThrowUserError('dashboard_illegal_id');
    }

    my $updates = _fields_from_params($WIDGET_FIELD_DEFS, $params);
    _validate_fields($WIDGET_FIELD_DEFS, $updates, 0);

    my $widget  = retrieve($path);
    while(my ($key, $value) = each(%$updates)) {
        $widget->{$key} = $value;
    }
    store $widget, $path;

    return $widget;
}

# Delete all widget_id related files and return ajax to fade/slide/close the
# widget.
sub delete_widget {
    require_account;
    my ($self, $params) = @_;

    my $id       = to_int($params->{id});
    my $widgets  = get_user_widgets();
    my $filtered = grep { $_->{id} != $id } @$widgets;
    set_user_widgets(undef, $filtered);
    return $filtered;
}

# save the widths of the columns in percentages
sub save_columns {
    require_account;
    my ($self, $params) = @_;

    my $prefs = get_user_prefs();
    foreach my $i (0 .. $prefs->{columns}) {
        my $key = "column" . $i;
        $prefs->{$key} = to_int($params->{$key});
    }
    set_user_prefs(undef, $prefs);
}

sub delete_overlay {
    require_account;
    my ($self, $params) = @_;

    my $user_id = to_int($params->{"user_id"});
    my $id      = to_int($params->{"id"});
    my $dir     = get_overlay_dir($user_id, $id);

    if (
        -d $dir
        && (($user_id == 0 && Bugzilla->user->in_group('admin'))
            || $user_id == Bugzilla->user->id)
      ) {
        remove_tree($dir);
    }
    else {
        ThrowUserError('dashboard_illegal_id');
    }

    return 1;
}

sub get_overlays {
    require_account;
    my ($self, $params) = @_;
    my $is_admin = Bugzilla->user->in_group('admin');

    my @overlays;
    push @overlays, get_user_overlays(Bugzilla->user->id);
    push @overlays, get_user_overlays(0);

    return [ grep { $is_admin || !$_->{'pending'} } @overlays ];
}

sub publish_overlay {
    require_account;
    my ($self, $params) = @_;

    my $id      = to_int($params->{"id"});
    my $user_id = to_int($params->{"user_id"});

    my $dir = get_overlay_dir($id, $user_id);
    my $overlay = File::Spec->catfile($dir, 'overlay');
    my $pending = File::Spec->catfile($dir, 'overlay.pending');

    if ($user_id == 0 && Bugzilla->user->in_group('admin') && -e $pending) {
        move($pending, $overlay);
    }
    else {
        ThrowUserError('dashboard_illegal_id');
    }
}

sub save_overlay {
    require_account;
    my ($self, $params) = @_;

    my $overlay = _fields_from_params($OVERLAY_FIELD_DEFS, $params);
    _validate_fields($OVERLAY_FIELD_DEFS, $overlay, 1);

    $overlay->{owner} = Bugzilla->user->id;
    $overlay->{created} = time;

    my $dest_dir;
    if($overlay->{shared}) {
        $dest_dir = get_shared_overlay_dir();
    } else {
        $dest_dir = get_user_overlay_dir();
    }

    my $overlaydir;
    do {
        $overlaydir = File::Spec->catdir($dest_dir, ++$overlay->{id});
    } until (!-d $overlaydir);

    make_path($overlaydir);

    foreach my $path (dir_glob(get_user_dir(), '*')) {
        if (-f $path) {
            if ($path =~ m/\/\d+\.widget$/ && $overlay->{"shared"}) {
                # strip usernames and passwords from widgets : todo to be
                # changed so that widgets can define their private/public
                # fields

                my $widget = retrieve($path);
                $widget->{'username'} = '';
                $widget->{'password'} = '';
                store $widget, $overlaydir . "/" . fileparse($path);
            }
            else {
                copy($path, $overlaydir)
                  or die "Copy failed: $!";
            }
        }
    }

    if ($overlay->{"shared"}
        && !Bugzilla->user->in_group('admin')) {
        store($overlay, $overlaydir . "/overlay.pending");
        $overlay->{state} = 'pending';
    }
    else {
        store($overlay, $overlaydir . "/overlay");
    }

    return $overlay;
}

sub load_overlay {
    require_account;
    my ($this, $params) = @_;

    my $user_id = to_int($params->{"user_id"});
    my $id      = to_int($params->{"id"});
    my $dir     = get_overlay_dir($user_id, $id);

    if(!-d $dir) {
        ThrowUserError('dashboard_illegal_id');
    }

    if(! (Bugzilla->user->in_group('admin') || $user_id == Bugzilla->user->id)) {
        ThrowUserError('dashboard_illegal_id');
    }

    load_user_overlay(undef, $user_id, $id);
    return 1;
}


# add new column and re-init the Sortable UI on success
sub add_column {
    require_account;
    my ($self, $params) = @_;

    my $prefs    = get_user_prefs();
    my $last_col = $prefs->{columns};
    $last_col++;

    # if new column can be added, tell jquery to create new UL element for the
    # column and call makeSortable() to re-init the Sortable UI elements
    if ($last_col < COLUMNS_MAX) {
        $prefs->{columns} = $last_col;
        set_user_prefs(undef, $prefs);
    }
    else {
        ThrowUserError('dashboard_max_columns');
    }
}

# delete last column if it is empty and re-init the Sortable UI on success
sub delete_column {
    require_account;
    my ($self, $params) = @_;

    my $prefs    = get_user_prefs();
    my $widgets  = get_user_widgets();
    my $last_col = List::Util::max(1, map { $_->{col} } @{$widgets});

    # If column can be deleted, decrease and save the column setting and tell
    # jQuery to remove the last column, resize widgets and call makeSortable()
    # to re-init the Sortable UI elements
    if ($last_col < $prefs->{columns}) {
        $last_col = $prefs->{columns};
        $prefs->{columns}--;
        set_user_prefs(undef, $prefs);
    }
    elsif ($last_col > 1) {
        ThrowUserError('dashboard_column_nonempty');
    }
    else {
        ThrowUserError('dashboard_last_column');
    }
}


# reset user workspace back to 1 column, zero widgets.
sub clear_workspace {
    require_account;
    clear_user_workspace();
}

sub get_columns {
    require_account;
    my ($self, $params) = @_;
    my $prefs = get_user_prefs(@_);

    my @columns;
    for (my $i = 0; $i <= $prefs->{columns}; $i++) {
        my $key = "column" . $i;
        my $width;
        if (! $prefs->{$key}) {
            $width = int(100 / ($prefs->{columns} + 1));
        } else {
            $width = ($prefs->{$key} > 10) ? int($prefs->{$key}) : 10;
        };

        push @columns, {
            width => $width
        };
    }

    return \@columns;
}


sub get_preferences {
    require_account;
    my ($self, $params) = @_;
    return get_user_prefs;
}


1;
