# -*- Mode: perl; indent-tabs-mode: nil -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Copyright (C) 2012 Jolla Ltd.
# Contact: Pami Ketolainen <pami.ketolainen@jollamobile.com>

package Bugzilla::Extension::Dashboard::Overlay;

use strict;

use base qw(Bugzilla::Object);

use Bugzilla::User;
use Bugzilla::Error;

use JSON;
use List::Util qw(sum);

use constant DB_TABLE => 'dashboard_overlays';


use constant DB_COLUMNS => qw(
    id
    name
    description
    columns
    created
    modified
    owner_id
    pending
    shared
    workspace
);

use constant REQUIRED_CREATE_FIELDS => qw(
    name
);

use constant UPDATE_COLUMNS => qw(
    name
    description
    columns
    modified
    pending
    shared
    workspace
);


use constant NUMERIC_COLUMNS => qw(
    owner_id
    pending
    shared
    workspace
);

use constant DATE_COLUMNS => qw(
    created
    modified
);

use constant VALIDATORS => {
    pending => \&Bugzilla::Object::check_boolean,
    shared => \&Bugzilla::Object::check_boolean,
    workspace => \&Bugzilla::Object::check_boolean,
    columns => \&_check_columns,
};

use constant AUDIT_CREATES => 0;
use constant AUDIT_UPDATES => 0;
use constant AUDIT_REMOVES => 0;

#############
# Accessors #
#############

sub owner_id    { return $_[0]->{'owner_id'}; }
sub description { return $_[0]->{'description'}; }
sub created     { return $_[0]->{'created'}; }
sub modified    { return $_[0]->{'modified'}; }
sub pending     { return $_[0]->{'pending'}; }
sub shared      { return $_[0]->{'shared'}; }
sub workspace   { return $_[0]->{'workspace'}; }

sub owner {
    my $self = shift;
    $self->{'owner'} ||= Bugzilla::User->new($self->owner_id);
    return $self->{'owner'};
}

sub columns {
    my $self = shift;
    $self->{'column_list'} ||= JSON->new->utf8->decode($self->{'columns'});
    return $self->{'column_list'};
}

sub widgets {
    my $self = shift;
    require Bugzilla::Extension::Dashboard::Widget;
    $self->{'widgets'} ||= Bugzilla::Extension::Dashboard::Widget->match(
        {overlay_id => $self->id});
    return $self->{'widgets'};
}

############
# Mutators #
############

sub set_name        { $_[0]->set('name', $_[1]); }
sub set_description { $_[0]->set('description', $_[1]); }
sub set_pending     { $_[0]->set('pending', $_[1]); }
sub set_workspace   { $_[0]->set('workspace', $_[1]); }
sub set_columns     { $_[0]->set('columns', $_[1]); }

sub set_shared {
    my ($self, $value) = @_;
    if (!$self->shared && $value) {
        $self->set('pending', 1);
    } elsif ($self->shared && !$value) {
        $self->set('pending', 0);
    }
    $self->set('shared', $value);
}

# These are here so that we can just pass nice hash to set_all
sub set_created     { }
sub set_modified    { }
sub set_owner       { }
sub set_user_can_edit    { }
sub set_user_can_publish { }

sub set_widgets {
    my ($self, $widgets) = @_;

    # Sort incoming to existing and new widgets
    my %existing_widgets;
    my @new_widgets;
    my $modified = 0;
    foreach my $widget (@{$widgets}) {
        if (!defined $widget->{id} || $widget->{overlay_id} != $self->id) {
            push(@new_widgets, $widget);
        } else {
            $existing_widgets{$widget->{id}} = $widget;
        }
    }

    # Get the old widgets and clear cache list
    my $db_widgets = $self->widgets;
    $self->{widgets} = [];

    # Update existing widgets and delete those not listed
    foreach my $widget (@{$db_widgets}) {
        my $params = $existing_widgets{$widget->id};
        if (defined $params) {
            delete $params->{id};
            delete $params->{overlay_id};
            $widget->set_all($params);
            $widget->update();
            push(@{$self->{widgets}}, $widget);
        } else {
            $widget->remove_from_db();
        }
        $modified = 1;
    }

    # Create new widgets
    foreach my $params (@new_widgets) {
        delete $params->{id};
        $params->{overlay_id} = $self->id;
        my $widget = Bugzilla::Extension::Dashboard::Widget->create($params);
        push(@{$self->{widgets}}, $widget);
        $modified = 1;
    }

    if ($modified) {
        $self->{modified} = Bugzilla->dbh->selectrow_array(
            'SELECT LOCALTIMESTAMP(0)');
    }
}


##############
# Validators #
##############

sub _check_columns {
    my ($invocant, $columns) = @_;
    ThrowCodeError("zero_columns_in_overlay") if (! @{$columns});

    # If column totals don't add up to 100%, spread the difference out.
    my $total = sum @{ $columns };
    my $delta = int((100 - $total) / @{ $columns });
    map { $_ += $delta } @{ $columns };

    return JSON->new->utf8->encode($columns);
}

###########
# Methods #
###########

sub create {
    my ($class, $params) = @_;

    # 'created', 'modified' and 'owner_id' can't be set by the caller
    $params->{created} = Bugzilla->dbh->selectrow_array(
        'SELECT LOCALTIMESTAMP(0)');
    $params->{modified} = $params->{created};
    $params->{owner_id} = Bugzilla->user->id;
    $params->{pending} = 1;

    # Set default columns if not provided
    if (!$params->{columns}) {
        $params->{columns} = [33, 33, 33];
    }

    my @widgets = @{delete $params->{widgets} || []};
    my $overlay = $class->SUPER::create($params);

    # Create widgets if provided
    foreach my $widget (@widgets) {
        require Bugzilla::Extension::Dashboard::Widget;
        $widget->{overlay_id} = $overlay->id;
        $widget = Bugzilla::Extension::Dashboard::Widget->create($widget);
        push(@{$overlay->{widgets}}, $widget);
    }
    return $overlay;
}

sub _update_modified_ts {
    my $self = shift;
    my $dbh = Bugzilla->dbh;
    my $modified_ts = $dbh->selectrow_array(
        'SELECT LOCALTIMESTAMP(0)');
    $dbh->do('UPDATE dashboard_overlays SET modified = ? WHERE id = ?',
                         undef, ($modified_ts, $self->id));
    $self->{modified} = $modified_ts;
}

sub update {
    my $self = shift;
    my($changes, $old) = $self->SUPER::update(@_);
    if (scalar(keys %$changes)) {
        $self->_update_modified_ts();
    }
    return $changes;
}

sub user_is_owner {
    my $self = shift;
    my $user = Bugzilla->user;
    return 0 unless defined $user;
    return $user->id == $self->owner_id;
}

sub user_can_edit {
    my $self = shift;
    return $self->user_is_owner;
}

sub user_can_access {
    my $self = shift;
    return $self->user_is_owner || ($self->shared && !$self->pending)
        || $self->user_can_publish;
}

sub user_can_publish {
    my $self = shift;
    my $user = Bugzilla->user;
    return 0 unless defined $user;
    return $self->shared && $user->in_group(
            Bugzilla->params->{dashboard_publish_group});
}

1;
