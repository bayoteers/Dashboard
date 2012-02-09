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
#   David Wilson <ext-david.3.wilson@nokia.com>
#   Jari Savolainen <ext-jari.a.savolainen@nokia.com>
#   Stephen Jayna <ext-stephen.jayna@nokia.com>

package Bugzilla::Extension::Dashboard;
use strict;
use base qw(Bugzilla::Extension);

use Data::Dumper;
use POSIX qw(strftime);

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;
use Bugzilla::User;

use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::Util;
use Bugzilla::Extension::Dashboard::Schema;
use Bugzilla::Extension::Dashboard::WebService;

use JSON;

our $VERSION = '0.01';


# Disable client-side caching of this HTTP request.
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

    while(my ($key, $value) = each(%$headers)) {
        print Bugzilla->cgi->header($key, $value);
    }
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
    migrate_workspace;

    my $config = {
        rss_max_items => int(Bugzilla->params->{dashboard_rss_max_items}),
        user_id => int(Bugzilla->user->id),
        user_login => Bugzilla->user->login,
        is_admin => Bugzilla->user->in_group('admin'),
        browsers_warn => Bugzilla->params->{"dashboard_browsers_warn"},
        browsers_block => Bugzilla->params->{"dashboard_browsers_block"},
        overlays => Bugzilla::Extension::Dashboard::WebService::get_overlays(),
        overlay_id => first_free_id(get_overlays_dir())
    };

    my $vars = $args->{vars};
    $vars->{dashboard_config} = JSON->new->utf8->pretty->encode($config);
    #$vars->{dashboard_config} = encode_json($config);
}


sub bb_common_links {
    my ($self, $args) = @_;

    $args->{links}->{Dashboard} = [
        {
            text => 'Dashboard',
            href => 'page.cgi?id=dashboard.html'
        }
    ];
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
