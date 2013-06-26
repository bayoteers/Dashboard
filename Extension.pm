# -*- Mode: perl; indent-tabs-mode: nil -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# The Initial Developer of the Original Code is "Nokia Corporation"
# Portions created by the Initial Developer are Copyright (C) 2010 the
# Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   Pami Ketolainen <pami.ketolainen@jollamobile.com>
#   David Wilson <ext-david.3.wilson@nokia.com>
#   Jari Savolainen <ext-jari.a.savolainen@nokia.com>
#   Stephen Jayna <ext-stephen.jayna@nokia.com>

package Bugzilla::Extension::Dashboard;
use strict;
use base qw(Bugzilla::Extension);

use POSIX qw(strftime);

use Bugzilla::Config qw(SetParam write_params);
use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;
use Bugzilla::User;

use Bugzilla::Extension::Dashboard::Util;

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

# Copypasta from colchange.cgi
# Maps parameters that control columns to the names of columns.
use constant COLUMN_PARAMS => {
    'useclassification'   => ['classification'],
    'usebugaliases'       => ['alias'],
    'usetargetmilestone'  => ['target_milestone'],
    'useqacontact'        => ['qa_contact', 'qa_contact_realname'],
    'usestatuswhiteboard' => ['status_whiteboard'],
    'usevotes'            => ['votes'],
};

# We only show these columns if an object of this type exists in the
# database.
use constant COLUMN_CLASSES => {
    'Bugzilla::Flag'    => 'flagtypes.name',
    'Bugzilla::Keyword' => 'keywords',
};

sub _get_columns {

    my @columns;
    my @hide;
    if (BUGZILLA_VERSION =~ /^4\..*/) {
        use Bugzilla::Search;
        @columns = keys(%{Bugzilla::Search::COLUMNS()});
        @hide = qw(relevance);
    } else {
        @columns = qw(bug_id opendate changeddate bug_severity priority
                rep_platform assigned_to assigned_to_realname reporter
                reporter_realname bug_status resolution classification alias
                target_milestone qa_contact qa_contact_realname
                status_whiteboard product component version op_sys short_desc
                short_short_desc estimated_time remaining_time work_time
                actual_time percentage_complete deadline);
        if (Bugzilla->params->{"usevotes"}) {
            push(@columns, "votes");
        }
        my @custom_fields = grep { $_->type != FIELD_TYPE_MULTI_SELECT }
                             Bugzilla->active_custom_fields;
        push(@columns, map { $_->name } @custom_fields);

        Bugzilla::Hook::process('colchange_columns', {'columns' => \@columns} );
    }
    foreach my $param (keys %{ COLUMN_PARAMS() }) {
        next if Bugzilla->params->{$param};
        foreach my $column (@{ COLUMN_PARAMS->{$param} }) {
            push(@hide, $column);
        }
    }

    foreach my $class (keys %{ COLUMN_CLASSES() }) {
        eval("use $class; 1;") || die $@;
        my $column = COLUMN_CLASSES->{$class};
        push(@hide, $column) if !$class->any_exist;
    }

    if (!Bugzilla->user->is_timetracker) {
        foreach my $column (TIMETRACKING_FIELDS) {
            push(@hide, $column);
        }
    }

    @columns = grep {my $col = $_; !scalar grep(/$col/, @hide)} @columns;
    @columns = sort @columns;
    return \@columns;
}

# Hook for page.cgi and dashboard
sub page_before_template {
    my ($self, $args) = @_;

    return if ($args->{page_id} !~ /^dashboard\.html$/);
    my $user = Bugzilla->login(LOGIN_REQUIRED);
    user_can_access_dashboard(1);

    cgi_no_cache;
    my $vars = $args->{vars};

    # Get the same list of columns as used in colchange.cgi

    $vars->{'columns'} = _get_columns;

    my $overlay_id = Bugzilla->cgi->param("overlay_id");
    if (!defined $overlay_id) {
       $overlay_id = Bugzilla->dbh->selectrow_array(
           "SELECT id FROM dashboard_overlays WHERE owner_id = ? ".
           "ORDER BY modified DESC", {}, Bugzilla->user->id);
    }

    my $config = {
        user_id => int($user->id),
        user_login => $user->login,
        can_publish => $user->in_group(
                Bugzilla->params->{dashboard_publish_group}),
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

    return unless user_can_access_dashboard();

    $args->{links}->{Dashboard} = [
        {
            text => 'Dashboard',
            href => 'page.cgi?id=dashboard.html'
        }
    ];
}

sub bb_group_params {
    my ($self, $args) = @_;
    push(@{$args->{group_params}}, 'dashboard_user_group',
        'dashboard_publish_group');
}

sub config_add_panels {
    my ($self, $args) = @_;
    my $modules = $args->{panel_modules};
    $modules->{Dashboard} = "Bugzilla::Extension::Dashboard::Config";
}

sub object_end_of_update {
    my ($self, $args) = @_;
    my ($new_obj, $old_obj, $changes) = @$args{qw(object old_object changes)};

    # Update user group param if group name changes
    if ($new_obj->isa("Bugzilla::Group") && defined $changes->{name}) {
        if ($old_obj->name eq Bugzilla->params->{dashboard_user_group}) {
            SetParam('dashboard_user_group', $new_obj->name);
            write_params();
        }
    }
}

sub webservice {
    my ($self, $args) = @_;
    $args->{dispatch}->{Dashboard} = "Bugzilla::Extension::Dashboard::WebService";
}


sub webservice_error_codes {
    my ($self, $args) = @_;
    my $error_map = $args->{error_map};
    $error_map->{'dashboard_access_denied'} = 10001;
    $error_map->{'overlay_publish_denied'} = 10002;
    $error_map->{'overlay_does_not_exist'} = 10003;
    $error_map->{'widget_does_not_exist'} = 10004;
    $error_map->{'overlay_access_denied'} = 10005;
    $error_map->{'overlay_edit_denied'} = 10006;
    $error_map->{'widget_edit_denied'} = 10007;
}

__PACKAGE__->NAME;
