# -*- Mode: perl; indent-tabs-mode: nil -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Copyright (C) 2012 Jolla Ltd.
# Contact: Pami Ketolainen <pami.ketolainen@jollamobile.com>

package Bugzilla::Extension::Dashboard::WebService;

use strict;
use warnings;

use base qw(Bugzilla::WebService);

use XML::Feed;

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;

use Bugzilla::Extension::Dashboard::Overlay;
use Bugzilla::Extension::Dashboard::Util;
use Bugzilla::Extension::Dashboard::Widget;


use constant PUBLIC_METHODS => qw(
    overlay_get
    overlay_delete
    overlay_list
    overlay_publish
    overlay_save
    widget_get
    widget_delete
    widget_list
    widget_save
    get_feed
);

use constant WIDGET_FIELDS => {
    id => 'int',
    name => 'string',
    overlay_id => 'int',
    type => 'string',
    color => 'string',
    col => 'int',
    pos => 'int',
    height => 'int',
    minimized => 'boolean',
    refresh => 'int',
};

use constant OVERLAY_FIELDS => {
    id => 'int',
    name => 'string',
    description => 'string',
    created => 'dateTime',
    modified => 'dateTime',
    shared => 'boolean',
    pending => 'boolean',
    workspace => 'boolean',
    user_can_edit => 'boolean',
    user_can_publish => 'boolean',
};


###################
# Overlay methods #
###################

sub _get_overlay {
    my ($self, $id, $edit, $publish) = @_;
    my $overlay = Bugzilla::Extension::Dashboard::Overlay->new($id);
    ThrowUserError('overlay_does_not_exist', { id => $id, class => 'Overlay' })
        unless defined $overlay;
    my $user = Bugzilla->user;
    ThrowUserError("overlay_access_denied", {id => $id })
        unless $overlay->user_can_access;
    if ($edit) {
        ThrowUserError("overlay_edit_denied", {id => $id })
            unless $overlay->user_can_edit;
    }
    if ($publish) {
        ThrowUserError("overlay_publish_denied", {id => $id })
            unless $overlay->user_can_publish;
    }
    return $overlay;
}

sub overlay_save {
    my ($self, $params) = @_;
    my $user = Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    # Publishing only via overlay_publish()
    delete $params->{pending};
    # Delete other extra stuff
    delete $params->{owner};
    delete $params->{user_can_edit};
    delete $params->{user_can_publish};


    my $overlay;
    my $changes = {};
    if (defined $params->{id}) {
        my $id = delete $params->{id};
        # Existing overlay
        $overlay = $self->_get_overlay($id, 1);
        $overlay->set_all($params);
        $changes = $overlay->update();
    } else {
        # New overlay
        $overlay = Bugzilla::Extension::Dashboard::Overlay->create($params);
    }
    return {
        overlay => $self->_overlay_to_hash($overlay),
        changes => $changes };
}

sub overlay_get {
    my ($self, $params) = @_;
    my $user = Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    ThrowCodeError('param_required', {
            function => 'Dashboard.overlay.get',
            param => 'id'})
        unless defined $params->{id};

    my $overlay = $self->_get_overlay($params->{id});
    return $self->_overlay_to_hash($overlay);
}

sub overlay_list {
    my $self = shift;
    my $user = Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    my @overlays;
    my @matches;

    # TODO Make this a single query to get the ids and use new_from_list()
    #
    # Shared overlays and the ones pending publishing if user is admin
    if ($user->in_group('admin')) {
        push(@matches, @{Bugzilla::Extension::Dashboard::Overlay->match({
                shared => 1})});
    } else {
        push(@matches, @{Bugzilla::Extension::Dashboard::Overlay->match({
                shared => 1, pending => 0})});
    }
    # Users own overlays
    push(@matches, @{Bugzilla::Extension::Dashboard::Overlay->match({
            owner_id => $user->id})});
    # Remove duplicates
    my %ids;
    while (my $overlay = shift @matches) {
        if (!defined $ids{$overlay->id}) {
            push(@overlays, $overlay);
            $ids{$overlay->id} = 1;
        }
    }
    # No need to get widgets for the list
    @overlays = map { $self->_overlay_to_hash($_, {widgets=>1}) } @overlays;
    return \@overlays;
}

sub overlay_delete {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    ThrowCodeError('param_required', {
            function => 'Dashboard.overlay_delete',
            param => 'id'})
        unless defined $params->{id};

    my $overlay = $self->_get_overlay($params->{id}, 1);
    $overlay->remove_from_db();
    return $self->overlay_list();
}

sub overlay_publish {
    my ($self, $params) = @_;
    my $user = Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    ThrowCodeError('param_required', {
            function => 'Dashboard.overlay_publish',
            param => 'id'})
        unless defined $params->{id};

    my $overlay = $self->_get_overlay($params->{id}, 0, 1);

    my $pending = $params->{withhold} ? 1 : 0;

    if ($overlay->shared) {
        $overlay->set_pending($pending);
        $overlay->update();
    }
    return $self->type('boolean', $overlay->pending);
}

##################
# Widget methods #
##################

sub _get_widget {
    my ($self, $id, $edit) = @_;
    my $widget = Bugzilla::Extension::Dashboard::Widget->new($id);
    ThrowUserError('widget_does_not_exist', { id => $id })
        unless defined $widget;
    if ($edit) {
        ThrowUserError('widget_edit_denied', { id => $id })
            unless $widget->user_can_edit;
    }
    return $widget;
}


sub widget_save {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    ThrowCodeError('params_required', {
            function => 'Dashboard.widget_save',
            params => ['id', 'overlay_id'] })
        unless defined $params->{id} || defined $params->{overlay_id};

    my $widget;
    my $changes = {};
    if (defined $params->{id}) {
        my $id = delete $params->{id};
        $widget = $self->_get_widget($id, 1);
        $widget->set_all($params);
        $changes = $widget->update();
    } else {
        $widget = Bugzilla::Extension::Dashboard::Widget->create($params);
    }
    return {
        widget => $self->_widget_to_hash($widget),
        changes => $changes};
}

sub widget_get {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    ThrowCodeError('param_required', {
            function => 'Dashboard.widget_get',
            param => 'id'})
        unless defined $params->{id};
    my $widget = $self->_get_widget($params->{id});
    return $self->_widget_to_hash($widget);
}

sub widget_list {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    ThrowCodeError('param_required', {
            function => 'Dashboard.widget_list',
            param => 'overlay_id'})
        unless defined $params->{overlay_id};
    my $overlay = $self->_get_overlay($params->{overlay_id});

    my @widgets = map { $self->_widget_to_hash($_) } @{$overlay->widgets};
    return \@widgets;
}

sub widget_delete {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    ThrowCodeError('param_required', {
            function => 'Dashboard.widget_delete',
            param => 'id'})
        unless defined $params->{id};
    my $widget = $self->_get_widget($params->{id}, 1);
    $widget->remove_from_db();
    return $self->_widget_to_hash($widget);
}

###################
# Private helpers #
###################
sub _overlay_to_hash {
    my ($self, $overlay, $exclude) = @_;
    my %result;
    while (my ($field, $type) = each %{(OVERLAY_FIELDS)}) {
        next if $exclude->{$field};
        $result{$field} = $self->type($type, $overlay->$field);
    }
    # owner, columns and widgets are special cases
    if (!$exclude->{owner}) {
        $result{owner} = {
            id => $self->type('int', $overlay->owner->id),
            login => $self->type('string', $overlay->owner->login),
            name => $self->type('string', $overlay->owner->name),
        };
    }
    if (!$exclude->{columns}) {
        my @columns;
        foreach my $col (@{$overlay->columns}) {
            push(@columns, $self->type('int', $col));
        }
        $result{columns} = \@columns;
    }
    if (!$exclude->{widgets}) {
        my @widgets;
        foreach my $widget (@{$overlay->widgets}) {
            push(@widgets, $self->_widget_to_hash(
                    $widget, $exclude->{widget}));
        }
        $result{widgets} = \@widgets;
    }
    return \%result;
}


sub _widget_to_hash {
    my ($self, $widget, $exclude) = @_;
    my %result;
    while (my ($field, $type) = each %{(WIDGET_FIELDS)}) {
        next if $exclude->{$field};
        $result{$field} = $self->type($type, $widget->$field);
    }
    $result{data} = $widget->data;
    return \%result
}


# Fetch an RSS/ATOM feed at the given URL, 'url', returning a parsed and
# normalized representation.
sub get_feed {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);

    my $browser = LWP::UserAgent->new();
    my $proxy_url = Bugzilla->params->{'proxy_url'};
    if ($proxy_url) {
        $browser->proxy(['http'], $proxy_url);
    } else {
        $browser->env_proxy();
    }

    $browser->timeout(10);
    my $response = $browser->get($params->{url});
    if($response->code != 200) {
        die $response->status_line;
    }

    my $feed = XML::Feed->parse(\($response->content))
        or die XML::Feed->errstr;

    sub _format_time {
        my ($dt) = @_;
        if($dt) {
            return $dt->datetime;
        }
        return '';
    }

    sub _ascii {
        my $s = shift || '';
        $s =~ s/[^[:ascii:]]//g;
        $s;
    }

    return {
        title => _ascii($feed->title),
        link => $feed->link,
        description => _ascii($feed->description),
        tagline => _ascii($feed->tagline),
        items => [ map { {
            title => _ascii($_->title),
            link => $_->link,
            description => _ascii($_->content->body),
            modified => _format_time($_->modified)
        } } $feed->items ]
    };
}


1;
