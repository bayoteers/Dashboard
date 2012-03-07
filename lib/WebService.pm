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

sub overlay_create {
    my ($self, $params) = @_;
    my $user = Bugzilla->login(LOGIN_REQUIRED);
    my $overlay = Bugzilla::Extension::Dashboard::Overlay->create($params);
    return $self->_overlay_to_hash($overlay);
}

sub overlay_get {
    my ($self, $params) = @_;
    my $user = Bugzilla->login(LOGIN_REQUIRED);

    defined $params->{id}
        || ThrowCodeError('param_required', { param => 'id' });

    my $overlay = Bugzilla::Extension::Dashboard::Overlay->new($params->{id});
    defined $overlay
        || ThrowCodeError('overlay_unknown', { id => $params->{id} });
    if ($overlay->owner_id != $user->id && !$overlay->shared
        || $overlay->pending){
        ThrowCodeError("overlay_acces_denied")
    }
    return $self->_overlay_to_hash($overlay);
}

sub overlay_list {
    my $self = shift;
    my $user = Bugzilla->login(LOGIN_REQUIRED);

    my @overlays;
    my $match = {};
    $match->{shared} = 1;
    $match->{pending} = 1;
    push @overlays, @{Bugzilla::Extension::Dashboard::Overlay->match({
            shared => 1, pending => $user->in_group('admin')})};
    push @overlays, @{Bugzilla::Extension::Dashboard::Overlay->match({
            owner_id => $user->id})};
    @overlays = map { $self->_overlay_to_hash($_, {widgets=>1}) } @overlays;
    return \@overlays;
}


sub _overlay_to_hash {
    my ($self, $overlay, $exclude) = @_;
    my %result;
    while (my ($field, $type) = each %{(OVERLAY_FIELDS)}) {
        next if $exclude->{$field} == 1;
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
            push(@columns, {
                    width => $self->type('int', $col->{width})
                });
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
        next if $exclude->{$field} == 1;
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
