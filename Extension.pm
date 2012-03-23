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

use POSIX qw(strftime);

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;
use Bugzilla::User;

use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::WebService;

use JSON;

our $VERSION = '1.00';


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
    my $vars = $args->{vars};

    # Get the same list of columns as used in colchange.cgi
    my @masterlist = ("bug_id", "opendate", "changeddate", "bug_severity", "priority",
                  "rep_platform", "assigned_to", "assigned_to_realname",
                  "reporter", "reporter_realname", "bug_status",
                  "resolution");

    if (Bugzilla->params->{"useclassification"}) {
        push(@masterlist, "classification");
    }

    push(@masterlist, ("product", "component", "version", "op_sys"));

    if (Bugzilla->params->{"usevotes"}) {
        push (@masterlist, "votes");
    }
    if (Bugzilla->params->{"usebugaliases"}) {
        unshift(@masterlist, "alias");
    }
    if (Bugzilla->params->{"usetargetmilestone"}) {
        push(@masterlist, "target_milestone");
    }
    if (Bugzilla->params->{"useqacontact"}) {
        push(@masterlist, "qa_contact");
        push(@masterlist, "qa_contact_realname");
    }
    if (Bugzilla->params->{"usestatuswhiteboard"}) {
        push(@masterlist, "status_whiteboard");
    }
    if (Bugzilla::Keyword->any_exist) {
        push(@masterlist, "keywords");
    }
    if (Bugzilla->has_flags) {
        push(@masterlist, "flagtypes.name");
    }
    if (Bugzilla->user->is_timetracker) {
        push(@masterlist, ("estimated_time", "remaining_time", "actual_time",
                           "percentage_complete", "deadline"));
    }

    push(@masterlist, ("short_desc", "short_short_desc"));

    my @custom_fields = grep { $_->type != FIELD_TYPE_MULTI_SELECT }
                             Bugzilla->active_custom_fields;
    push(@masterlist, map { $_->name } @custom_fields);

    Bugzilla::Hook::process('colchange_columns', {'columns' => \@masterlist} );

    $vars->{'masterlist'} = \@masterlist;


    my $overlay_id = Bugzilla->cgi->param("overlay_id");
    if (!defined $overlay_id) {
       $overlay_id = Bugzilla->dbh->selectrow_array(
           "SELECT id FROM dashboard_overlays WHERE owner_id = ? ".
           "ORDER BY modified DESC", {}, Bugzilla->user->id);
    }

    my $config = {
        user_id => int(Bugzilla->user->id),
        user_login => Bugzilla->user->login,
        is_admin => Bugzilla->user->in_group('admin'),
        rss_max_items => int(Bugzilla->params->{dashboard_rss_max_items}),
        browsers_warn => Bugzilla->params->{"dashboard_browsers_warn"},
        browsers_block => Bugzilla->params->{"dashboard_browsers_block"},
        overlay_id => $overlay_id,
    };

    $vars->{dashboard_config} = JSON->new->utf8->pretty->encode($config);
}

sub db_schema_abstract_schema {
    my ($self, $args) = @_;
    my $schema = $args->{schema};

    $schema->{dashboard_overlays} = {
        FIELDS => [
            id => {
                TYPE => 'MEDIUMSERIAL',
                NOTNULL => 1,
                PRIMARYKEY => 1,
            },
            name => {
                TYPE => 'TINYTEXT',
                NOTNULL => 1,
            },
            description => {
                TYPE => 'TINYTEXT',
            },
            columns => {
                TYPE => 'TINYTEXT',
                NOTNULL => 1,
            },
            created => {
                TYPE => 'DATETIME',
                NOTNULL => 1,
            },
            modified => {
                TYPE => 'DATETIME',
                NOTNULL => 1,
            },
            owner_id => {
                TYPE => 'INT3',
                NOTNULL => 1,
                REFERENCES => {
                    TABLE => 'profiles',
                    COLUMN => 'userid',
                    DELETE => 'CASCADE',
                },
            },
            pending => {
                TYPE => 'BOOLEAN',
                NOTNULL => 1,
                DEFAULT => 0,
            },
            shared => {
                TYPE => 'BOOLEAN',
                NOTNULL => 1,
                DEFAULT => 0,
            },
            workspace => {
                TYPE => 'BOOLEAN',
                NOTNULL => 1,
                DEFAULT => 0,
            }
        ]
    };

    $schema->{dashboard_widgets} = {
        FIELDS => [
            id => {
                TYPE => 'MEDIUMSERIAL',
                NOTNULL => 1,
                PRIMARYKEY => 1,
            },
            name => {
                TYPE => 'TINYTEXT',
                NOTNULL => 1,
            },
            type => {
                TYPE => 'TINYTEXT',
                NOTNULL => 1,
            },
            overlay_id => {
                TYPE => 'INT3',
                NOTNULL => 1,
                REFERENCES => {
                    TABLE => 'dashboard_overlays',
                    COLUMN => 'id',
                    DELETE => 'CASCADE',
                },
            },
            color => {
                TYPE => 'TINYTEXT',
            },
            col => {
                TYPE => 'INT1',
                DEFAULT => 0,
            },
            pos => {
                TYPE => 'INT1',
                DEFAULT => 0,
            },
            height => {
                TYPE => 'INT2',
                DEFAULT => 100,
            },
            minimized => {
                TYPE => 'BOOLEAN',
                NOTNULL => 1,
                DEFAUL => 0,
            },
            refresh => {
                TYPE => 'INT2',
                NOTNULL => 1,
                DEFAULT => 0,
            },
            data => {
                TYPE => 'MEDIUMTEXT',
            }
        ]
    };
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
    $error_map->{'dashboard_object_access_denied'} = 10001;
    $error_map->{'overlay_publish_denied'} = 10002;
    $error_map->{'overlay_does_not_exist'} = 10003;
    $error_map->{'widget_does_not_exist'} = 10004;
}

__PACKAGE__->NAME;
