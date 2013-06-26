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
#   Jari Savolainen <ext-jari.a.savolainen@nokia.com>

package Bugzilla::Extension::Dashboard::Config;
use strict;
use warnings;

use Bugzilla::Config::Common;

sub get_param_list {
    my ($class) = @_;

    my @groups = sort @{Bugzilla->dbh->selectcol_arrayref(
            "SELECT name FROM groups")};
    my ($old_group) = grep {$_ eq 'dashboard_publisher'} @groups;

    my @param_list = (
        {
            name => 'dashboard_user_group',
            desc => 'User group that has access to dashboards',
            type    => 's',
            choices => ['', @groups],
            default => '',
        },
        {
            name => 'dashboard_publish_group',
            desc => 'User group that is allowed to publish dashboards',
            type    => 's',
            choices => \@groups,
            default => defined $old_group ? $old_group : 'admin',
        },
        {
           name => 'dashboard_max_workspaces',
           desc => 'Maximum number of temporary "workspace" overlays a user '.
                   'may have before automatically deleting the oldest one.',
           type => 't',
           default => '5',
           checker => \&check_numeric,
        },
        {
           name => 'dashboard_browsers_warn',
           desc => 'Regexp for browsers that are not recommended',
           type => 't',
           default => 'AppleWebkit',
           checker => \&check_regexp,
        },
        {
           name => 'dashboard_browsers_block',
           desc => 'Regexp for browsers that are not supported',
           type => 't',
           default => 'MSIE\s\d\.\d',
           checker => \&check_regexp,
        },
        {
           name => 'dashboard_rss_max_items',
           desc => 'How many items rss widget can display at a time',
           type => 't',
           default => '25',
           checker => \&check_numeric,
        },
    );
    return @param_list;
}

1;
