# -*- Mode: perl; indent-tabs-mode: nil -*-
#
# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.
#
# Copyright (C) 2013 Jolla Ltd.
# Contact: Pami Ketolainen <pami.ketolainen@jollamobile.com>

package Bugzilla::Extension::Dashboard::Util;
use strict;
use warnings;
use base qw(Exporter);

our @EXPORT = qw(
    user_can_access_dashboard
);

use Bugzilla;
use Bugzilla::Error;

sub user_can_access_dashboard {
    my ($throwerror) = @_;
    my $ingroup = Bugzilla->user->in_group(
        Bugzilla->params->{dashboard_user_group});

    ThrowUserError("dashboard_access_denied") if ($throwerror && !$ingroup);
    return $ingroup;
}

1;
