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
# The Original Code is the Dashboard Bugzilla Extension.
#
# The Initial Developer of the Original Code is "Nokia Corporation"
# Portions created by the Initial Developer are Copyright (C) 2010 the
# Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   Jari Savolainen <ext-jari.a.savolainen@nokia.com>
#   Stephen Jayna <ext-stephen.jayna@nokia.com>

package Bugzilla::Extension::Dashboard;
use strict;
use base qw(Bugzilla::Extension);

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;
use Bugzilla::User;

use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::Util qw(
    cgi_no_cache
    dir_glob
    load_user_overlay
    get_user_prefs
);
use Bugzilla::Extension::Dashboard::WebService;

use JSON::PP;

our $VERSION = '0.01';

# See the documentation of Bugzilla::Hook ("perldoc Bugzilla::Hook"
# in the bugzilla directory) for a list of all available hooks.
sub install_update_db {
    my ($self, $args) = @_;
}

# Hook for page.cgi and dashboard
sub page_before_template {
    my ($self, $args) = @_;

    if ($args->{page_id} !~ /^dashboard\.html$/) {
        return;
    } elsif (! Bugzilla->user->id) {
        ThrowUserError('login_required');
    }

    cgi_no_cache;

    $args->{vars}->{dashboard_config} = JSON->new->utf8->pretty->encode({
    #$args->{vars}->{dashboard_config} = encode_json({
        rss_max_items => int(Bugzilla->params->{dashboard_rss_max_items}),
        user_login => Bugzilla->user->login,
        is_admin => Bugzilla->user->in_group('admin'),
        workspace => get_user_prefs,
        browsers_warn => Bugzilla->params->{"dashboard_browsers_warn"},
        browsers_block => Bugzilla->params->{"dashboard_browsers_block"},
        overlays => Bugzilla::Extension::Dashboard::WebService::get_overlays(),
    });

    if (Bugzilla->params->{"dashboard_jquery_path"}) {
        $vars->{dashboard_jquery_path} = Bugzilla->params->{"dashboard_jquery_path"};
    }
}

sub config {
    my ($self, $args) = @_;

    my $config = $args->{config};
    $config->{Dashboard} = "Bugzilla::Extension::Dashboard::Config";
}

sub config_add_panels {
    my ($self, $args) = @_;

    my $modules = $args->{panel_modules};
    $modules->{Dashboard} = "Bugzilla::Extension::Dashboard::Config";
}

sub webservice {
    my ($self, $args) = @_;
    $args->{dispatch}->{Dashboard} = "Bugzilla::Extension::Dashboard::WebService";
}

sub webservice_error_codes {
    my ($self, $args) = @_;

    my $error_map = $args->{error_map};
    $error_map->{'dashboard_my_error'} = 10001;
}

__PACKAGE__->NAME;
