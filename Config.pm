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

use constant NAME => 'Dashboard';

use constant REQUIRED_MODULES => [
                                   {
                                      package => 'HTML-Scrubber',
                                      module  => 'HTML::Scrubber',
                                      version => 0.08,
                                   },
                                 ];

use constant OPTIONAL_MODULES => [];

use constant EXTENSION_DIR   => '/extensions/Dashboard';
use constant COLUMNS_DEFAULT => 3;
use constant COLUMNS_MAX     => 4;
use constant WIDGETS_MAX     => 30;

__PACKAGE__->NAME;
