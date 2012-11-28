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
    {
        package => 'XML-Feed',
        module => 'XML::Feed',
        version => 0.40,
    },
];

use constant OPTIONAL_MODULES => [];

__PACKAGE__->NAME;
