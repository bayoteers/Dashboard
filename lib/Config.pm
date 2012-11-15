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

use Exporter 'import';
our @EXPORT = qw(
    COLUMNS_DEFAULT
    COLUMNS_MAX
    WIDGETS_MAX
);

use constant COLUMNS_DEFAULT => 3;
use constant COLUMNS_MAX     => 4;
use constant WIDGETS_MAX     => 30;

our $sortkey = 5000;

sub get_param_list {
    my ($class) = @_;

    my @param_list = (
                      {
                         name => 'dashboard_max_workspaces',
                         desc => 'Maximum number of temporary "workspace" '.
                                 'overlays a user may have before '.
                                 'automatically deleting the oldest one.',
                         type => 't', # can't find docs, should be numeric.
                         default => '5',
                      },
                      {
                         name => 'dashboard_browsers_warn',
                         desc => 'Regexp for browsers that are not recommended',
                         type => 't',
                         default => 'AppleWebkit',
                      },
                      {
                         name => 'dashboard_browsers_block',
                         desc => 'Regexp for browsers that are not supported',
                         type => 't',
                         default => 'MSIE\s\d\.\d',
                      },
                      {
                         name => 'dashboard_rss_max_items',
                         desc => 'How many items rss widget can display at a time',
                         type => 't',
                         default => '25'
                      },
                      {
                         name => 'dashboard_rss_color_new',
                         desc => 'Color for RSS item that was just displayed',
                         type => 't',
                         default => '#ffaa00',
                      },
                      {
                         name => 'dashboard_rss_color_unread',
                         desc => 'Color for RSS item that is not read yet',
                         type => 't',
                         default => '#ffaa00',
                      },
                      {
                         name => 'dashboard_rss_color_read',
                         desc => 'Color for RSS item that has been read',
                         type => 't',
                         default => '#cccccc',
                      },
                     );
    return @param_list;
}

1;
