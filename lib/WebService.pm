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

use Bugzilla::Error;
use Bugzilla::Util;

use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::Overlay;
use Bugzilla::Extension::Dashboard::Schema qw(to_int);
use Bugzilla::Extension::Dashboard::Util;


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

    $overlay->delete();
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
    return merge $overlay;
}


sub clone_overlay {
    require_account;
    my ($this, $params) = @_;

    my $overlay = Bugzilla::Extension::Dashboard::Overlay->from_store(
        $params->{user_id}, $params->{id});
    return merge $overlay->clone($params->{new_id});
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

    return {
        title => $feed->title,
        link => $feed->link,
        description => $feed->description,
        tagline => $feed->tagline,
        items => [ map { {
            title => $_->title,
            link => $_->link,
            description => $_->content->body,
            modified => _format_time($_->modified)
        } } $feed->items ]
    };
}


1;
