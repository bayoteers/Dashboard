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

use File::Basename;
use File::Path qw(remove_tree);
use File::Spec;
use List::Util;

use Bugzilla::Util;
use Bugzilla::Error;

use Bugzilla::Extension::Dashboard::Util qw(
    clear_user_workspace
    get_user_overlays
    get_overlay_dir
    get_user_prefs
    get_user_widgets
    to_int
    set_user_prefs
);
use Bugzilla::Extension::Dashboard::Config;


sub require_account {
    if(! Bugzilla->user->id) {
        die 'You must provide Bugzilla_login and Bugzilla_password parameters.';
    }
}


sub _widget_from_params {
    my ($params) = @_;
    my $widget;

    # Numerical fields. Each widget MUST have unique id, position (vertical),
    # column it is and height of the widget
    my @fields = qw(id pos col height refresh);
    foreach (@fields) {
        $widget->{$_} = to_int($params->{ "widget_" . $_ });
    }

    # true/false fields
    @fields = qw(movable removable collapsible editable resizable resized
        maximizable minimized controls refreshable);
    foreach (@fields) {
        $widget->{$_} = to_bool($params->{ "widget_" . $_ });
    }

    # text fields
    @fields = qw(title URL username password);
    foreach (@fields) {
        $widget->{$_} = scrub_string($params->{ "widget_" . $_ });
    }

    # ASCII-only fields. TODO: add type verification based on installed widget
    # types.
    foreach my $field (qw(type)) {
        $widget->{$field} = clean_text($params->{ "widget_" . $field });
    }

    # color
    $widget->{'color'} = $params->{"widget_color"} =~ /color-(gray|yellow|red|blue|white|orange|green)/ ? $1 : "gray";
    return $widget;
}

# create new widget and store all required preferences
sub new_widget {
    require_account;
    my ($self, $params) = @_;

    my $widget_id = to_int($params->{'widget_id'});
    if ($widget_id <= 0) {
        ThrowUserError('dashboard_illegal_id');
    }

    # if widget can be created, get required prefences, store them and tell
    # jquery to save any extra preferences the widget has
    if ((scalar get_user_widgets()) >= WIDGETS_MAX) {
        ThrowUserError('dashboard_max_widgets');
    }

    my $widget = _widget_from_params($params);
    # force the widget to be resized on load
    $widget->{resized} = 1;

    my $widgets = get_user_widgets();
    push @$widgets, $widget;
    set_user_widgets(undef, $widgets);
    return $widget;
}

# get and store all extended widget preferences
sub save_widget {
    require_account;
    my ($self, $params) = @_;

    my $widget_id = to_int($params->{'widget_id'});

    my $path = get_widget_path(undef, $widget_id);
    if ($widget_id <= 0 || !-e $path) {
        ThrowUserError('dashboard_illegal_id');
    }

    my $widget  = retrieve($path);
    my $updates = _widget_from_params();
    $widget->{$_} = $updates->{$_} for keys %$updates;
    store $widget, $path;
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

    my $user_id = to_int($params->{"overlay_user_id"});
    my $id      = to_int($params->{"overlay_id"});
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

    my $id      = to_int($params->{"overlay_id"});
    my $user_id = to_int($params->{"overlay_user_id"});

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

    my $overlay = {
                    owner   => Bugzilla->user->id,
                    created => time
                  };

    my $datatargetdir = get_user_overlay_dir();

    # true/false fields
    my @fields = qw(shared);
    foreach (@fields) {
        $overlay->{$_} = to_bool($params->{ "overlay_" . $_ });
    }
    if ($overlay->{"shared"}) {
        $datatargetdir = get_shared_overlay_dir();
    }

    # text fields
    @fields = qw(name description);
    foreach (@fields) {
        $overlay->{$_} = scrub_string($params->{ "overlay_" . $_ });
    }

    my $i = 1;
    my $overlaydir;
    do {
        $overlaydir = File::Spec->catdir($datatargetdir, $i++);
    } until (!-d $overlaydir);

    make_path $overlaydir;

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
        store $overlay, $overlaydir . "/overlay.pending";
        return 'pending';
    }
    else {
        store $overlay, $overlaydir . "/overlay";
        return 'ok';
    }
}

sub load_overlay {
    require_account;
    my ($this, $params) = @_;

    my $user_id = to_int($params->{"overlay_user_id"});
    my $id      = to_int($params->{"overlay_id"});
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


sub handle_dashboard {
    require_account;
    my ($self, $params) = @_;

    my $column_total_width = 0;
    my $column_width       = 0;

    my $prefs = get_user_prefs(@_);
    my $out;

    # Generate column->widgets structure and populate it with widget
    # preferences.
    for (my $i = 0 ; $i <= $prefs->{columns} ; $i++) {
        if (!$prefs->{ "column" . $i }) {
            $out->{"column"}->[$i] = int(100 / ($prefs->{columns} + 1));
        }
        else {
            $column_width = int($prefs->{ "column" . $i });
            $out->{"column"}->[$i] = ($column_width > 10) ? $column_width : 10;
        }
        $column_total_width += $out->{"column"}->[$i];
        my $widget;
        $widget->{'id'} = 0;
        $out->{"columns"}->[$i]->[0] = $widget;
    }

    if ($column_total_width != 100) {
        for (my $i = 0 ; $i <= $prefs->{columns} ; $i++) {
            $out->{"column"}->[$i] = int(100 / ($prefs->{columns} + 1));
        }
    }

    return $out;
}



sub get_preferences {
    require_account;
    my ($self, $params) = @_;
    return get_user_prefs;
}


1;
