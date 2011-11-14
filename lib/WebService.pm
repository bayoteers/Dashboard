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
    fields_from_params
    validate_fields
    fixup_types
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
    $WIDGET_FIELD_DEFS
    $COLUMN_FIELD_DEFS
    $OVERLAY_FIELD_DEFS
    to_bool
    to_color
    to_int
);


sub require_account {
    if(! Bugzilla->user->id) {
        ThrowUserError('login_required');
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
    my @widgets  = get_user_widgets();
    my $filtered = [ grep { $_->{id} != $id } @widgets ];
    set_user_widgets(undef, $filtered);
    return $filtered;
}

# save the widths of the columns in percentages
sub save_columns {
    require_account;
    my ($self, $params) = @_;
    my $prefs = get_user_prefs();

    my $columns = $params->{columns};
    if(@$columns >= COLUMNS_MAX) {
        ThrowUserError('dashboard_max_columns');
    }

    foreach my $col (@$columns) {
        if(! to_int($col->{width})) {
            ThrowUserError('dashboard_illegal_id'); # TODO
        }
    }

    $prefs->{columns} = $columns;
    set_user_prefs(undef, $prefs);
    return $columns;
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

    return get_overlays();
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
    return get_user_prefs;
}


# add new column and re-init the Sortable UI on success
sub add_column {
    require_account;
    my ($self, $params) = @_;
    my $prefs = get_user_prefs();
    if(@{$prefs->{columns}} >= COLUMNS_MAX) {
        ThrowUserError('dashboard_max_columns');
    }

    push @{$prefs->{columns}}, {
        width => (@{$prefs->{columns}} + 1) / 100
    };

    set_user_prefs(undef, $prefs);
    return $prefs->{columns};
}


# Delete last column if it is empty.
sub delete_column {
    require_account;
    my ($self, $params) = @_;

    my $prefs    = get_user_prefs();

    my $idx = @{$prefs->{columns}} - 1;
    if($idx == 0) {
        ThrowUserError('dashboard_last_column');
    } elsif(grep { $_->{col} >= $idx } @{$prefs->{widgets}}) {
        ThrowUserError('dashboard_column_nonempty');
    }

    pop @{$prefs->{columns}};
    set_user_prefs(undef, $prefs);
    return $prefs->{columns};
}


# reset user workspace back to 1 column, zero widgets.
sub clear_workspace {
    require_account;
    clear_user_workspace();
    return get_user_prefs();
}


sub save_workspace {
    require_account;
    my ($self, $params) = @_;

    if(! UNIVERSAL::isa($params->{widgets}, 'ARRAY')) {
        die "'widgets' field must be an array.";
    }

    foreach my $widget (@{$params->{widgets}}) {
        validate_fields($WIDGET_FIELD_DEFS, $widget, 1);
    }

    if(! UNIVERSAL::isa($params->{columns}, 'ARRAY')) {
        die "'widgets' field must be an array.";
    }

    foreach my $column (@{$params->{columns}}) {
        validate_fields($COLUMN_FIELD_DEFS, $column, 1);
    }

    my $prefs = get_user_prefs();
    $prefs->{widgets} = $params->{widgets};
    $prefs->{columns} = $params->{columns};
    set_user_prefs(undef, $prefs);
    return $prefs;
}


sub get_preferences {
    require_account;
    my ($self, $params) = @_;
    return get_user_prefs;
}


1;
