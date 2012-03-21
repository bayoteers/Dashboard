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
use File::Copy;
use File::Spec;
use List::Util;
use Storable;
use XML::Feed;

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;

use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::Overlay;
use Bugzilla::Extension::Dashboard::Widget;
use Bugzilla::Extension::Dashboard::Schema qw(to_int);
use Bugzilla::Extension::Dashboard::Util;

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
};


###################
# Overlay methods #
###################

sub _get_overlay {
    my ($self, $id) = @_;
    my $overlay = Bugzilla::Extension::Dashboard::Overlay->new($id);
    ThrowCodeError('object_does_not_exist', { id => $id, class => 'Overlay' })
        unless defined $overlay;
    return $overlay;
}

sub overlay_save {
    my ($self, $params) = @_;
    my $user = Bugzilla->login(LOGIN_REQUIRED);

    # Publishing only via overlay_publish()
    delete $params->{pending};

    my $overlay;
    my $changes = {};
    if (defined $params->{id}) {
        my $id = delete $params->{id};
        # Existing overlay
        $overlay = $self->_get_overlay($id);
        ThrowCodeError("dashboard_object_access_denied", {
                class => 'Overlay', id => $id })
            unless ($overlay->owner_id == $user->id);
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

    ThrowCodeError('param_required', {
            function => 'Dashboard.overlay.get',
            param => 'id'})
        unless defined $params->{id};

    my $overlay = $self->_get_overlay($params->{id});
    ThrowCodeError("dashboard_object_access_denied", {
            class => 'Overlay', id => $params->{id} })
        unless $overlay->user_is_owner ||
                ($overlay->shared &&
                    (!$overlay->pending || $user->in_group('admin')));
    return $self->_overlay_to_hash($overlay);
}

sub overlay_list {
    my $self = shift;
    my $user = Bugzilla->login(LOGIN_REQUIRED);

    my @overlays;
    my @matches;

    # Shared overlays and the ones pending publishing if user is admin
    push(@matches, @{Bugzilla::Extension::Dashboard::Overlay->match({
            shared => 1, pending => $user->in_group('admin')})});
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
    ThrowCodeError('param_required', {
            function => 'Dashboard.overlay_delete',
            param => 'id'})
        unless defined $params->{id};

    my $overlay = $self->_get_overlay($params->{id});
    ThrowCodeError("dashboard_object_access_denied", {
            class => 'Overlay', id => $params->{id} })
            unless $overlay->user_is_owner;

    $overlay->remove_from_db();
    return $self->overlay_list();
}

sub overlay_publish {
    my ($self, $params) = @_;
    my $user = Bugzilla->login(LOGIN_REQUIRED);

    ThrowCodeError('param_required', {
            function => 'Dashboard.overlay_publish',
            param => 'id'})
        unless defined $params->{id};

    # Only admin can publish
    ThrowCodeError("overlay_publish_denied")
        unless $user->in_group('admin');

    my $overlay = $self->_get_overlay($params->{id});

    if ($overlay->pending) {
        $overlay->set_pending(0);
        $overlay->update();
    }
    return $overlay->pending;
}

##################
# Widget methods #
##################

sub _get_widget {
    my ($self, $id) = @_;
    my $widget = Bugzilla::Extension::Dashboard::Widget->new($id);
    ThrowCodeError('object_does_not_exist', { id => $id, class => 'Widget'})
        unless defined $widget;
    return $widget;
}


sub widget_save {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);

    ThrowCodeError('params_required', {
            function => 'Dashboard.widget_save',
            params => ['id', 'overlay_id'] })
        unless defined $params->{id} || defined $params->{overlay_id};

    my $widget;
    my $changes = {};
    if (defined $params->{id}) {
        my $id = delete $params->{id};
        $widget = $self->_get_widget($id);
        ThrowCodeError("dashboard_object_access_denied", {
                class => 'Widget', id => $id })
            unless $widget->user_is_owner;
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
    ThrowCodeError('param_required', {
            function => 'Dashboard.widget_get',
            param => 'id'})
        unless defined $params->{id};
    my $widget = $self->_get_widget($params->{id});
    ThrowCodeError("dashboard_object_access_denied", {
            class => 'Widget', id => $params->{id} })
        unless $widget->user_is_owner;
    return $self->_widget_to_hash($widget);
}

sub widget_list {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);
    ThrowCodeError('param_required', {
            function => 'Dashboard.widget_get',
            param => 'id'})
        unless defined $params->{overlay_id};
    my $overlay = $self->_get_overlay($params->{overlay_id});
    ThrowCodeError("dashboard_object_access_denied", {
            class => 'Overlay', id => $params->{overlay_id} })
        unless $overlay->user_is_owner ||
                ($overlay->shared && !$overlay->pending);

    my @widgets = map { $self->_widget_to_hash($_) } @{$overlay->widgets};
    return \@widgets;
}

sub widget_delete {
    my ($self, $params) = @_;
    Bugzilla->login(LOGIN_REQUIRED);
    ThrowCodeError('param_required', {
            function => 'Dashboard.widget_delete',
            param => 'id'})
        unless defined $params->{id};
    my $widget = $self->_get_widget($params->{id});
    ThrowCodeError("dashboard_object_access_denied", {
            class => 'Widget', id => $params->{id} })
        unless $widget->user_is_owner;
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


# Old methods




sub require_account {
    if(! Bugzilla->user->id) {
        ThrowUserError('login_required');
    }
}


sub delete_overlay {
    require_account;
    my ($self, $params) = @_;

    my $overlay = Bugzilla::Extension::Dashboard::Overlay->from_store(
        $params->{user_id}, $params->{id});
    if($overlay) {
        $overlay->delete();
    }
    return get_overlays();
}


sub get_overlay {
    require_account;
    my ($self, $params) = @_;

    my $overlay = Bugzilla::Extension::Dashboard::Overlay->from_store(
        $params->{user_id}, $params->{id});
    return merge $overlay;
}


sub get_overlays {
    require_account;
    my ($self, $params) = @_;

    my @overlays;
    push @overlays, overlays_for_user(Bugzilla->user->id);
    push @overlays, overlays_for_user(0);

    # Remove fields useless for list view.
    foreach my $overlay (@overlays) {
        delete @$overlay{qw(columns widgets)};
    }

    my $is_admin = Bugzilla->user->in_group('admin');
    return [ grep { $is_admin || !$_->{'pending'} } @overlays ];
}


sub publish_overlay {
    require_account;
    my ($self, $params) = @_;

    my $overlay = Bugzilla::Extension::Dashboard::Overlay->from_store(
        $params->{user_id}, $params->{id});
    return merge $overlay->publish();
}


# Like save_overlay, but takes all data from the request.
sub set_overlay {
    require_account;
    my ($self, $params) = @_;

    my $class = 'Bugzilla::Extension::Dashboard::Overlay';

    my $overlay = $class->from_store($params->{id}, $params->{user_id});

    if($overlay) {
        $overlay->update_from($params);
    } else {
        $overlay = $class->from_hash($params);
    }

    $overlay->save();
    trim_workspace_overlays();
    return merge $overlay;
}


sub clone_overlay {
    require_account;
    my ($this, $params) = @_;

    my $overlay = Bugzilla::Extension::Dashboard::Overlay->from_store(
        $params->{user_id}, $params->{id});
    my $result = merge $overlay->clone($params->{new_id});
    trim_workspace_overlays();
    return $result;
}


# Fetch an RSS/ATOM feed at the given URL, 'url', returning a parsed and
# normalized representation.
sub get_feed {
    require_account;
    my ($self, $params) = @_;

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
        my $s = shift;
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
