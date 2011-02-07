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
# The Original Code is the Bugzilla Example Plugin.
#
# The Initial Developer of the Original Code is Canonical Ltd.
# Portions created by Canonical Ltd. are Copyright (C) 2008
# Canonical Ltd. All Rights Reserved.
#
# Contributor(s): Max Kanat-Alexander <mkanat@bugzilla.org>
#                 Bradley Baetz <bbaetz@acm.org>
#                 Jari Savolainen <ext-jari.a.savolainen@nokia.com>

package Bugzilla::Extension::Dashboard::Config;
use strict;
use warnings;

use Bugzilla::Config::Common;

our $sortkey = 5000;

sub get_param_list {
    my ($class) = @_;

    my @param_list = (
			{
				name => 'dashboard_rss_max_items',
				desc => 'How many items rss widget can display at a time',
				type => 't',
			},
			{
				name => 'dashboard_rss_color_new',
				desc => 'Color for RSS item that was just displayed',
				type => 't',
			},
			{
				name => 'dashboard_rss_color_unread',
				desc => 'Color for RSS item that is not read yet',
				type => 't',
			},
			{
				name => 'dashboard_rss_color_read',
				desc => 'Color for RSS item that has been read',
				type => 't',
			},
    );
    return @param_list;
}

1;
