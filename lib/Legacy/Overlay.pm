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
# The Original Code is the Bugzilla Bug Tracking System.
#
# The Initial Developer of the Original Code is Everything Solved, Inc.
# Portions created by Everything Solved, Inc. are Copyright (C) 2007
# Everything Solved, Inc. All Rights Reserved.
#
# Contributor(s):
#   David Wilson <ext-david.3.wilson@nokia.com>
#

package Bugzilla::Extension::Dashboard::Overlay;

use strict;
use File::Path qw(remove_tree);

use Bugzilla::Extension::Dashboard::Legacy::Schema qw(OVERLAY_DEFS parse to_int);
use Bugzilla::Extension::Dashboard::Legacy::Util;


sub from_hash {
    my ($class, $hash) = @_;
    my $self = parse(OVERLAY_DEFS, $hash);
    bless($self);
}


sub from_store {
    my ($class, $user_id, $overlay_id) = @_;

    $user_id = to_int($user_id);
    $overlay_id = to_int($overlay_id);

    # Ensure current user has right to open overlay.
    if($user_id && $user_id != Bugzilla->user->id
       && !Bugzilla->user->in_group('admin')) {
        ThrowUserError('dashboard_illegal_id');
    }

    my $dir = get_overlay_dir($user_id, $overlay_id);
    if(!-d $dir || !scalar dir_glob($dir, '*')) {
        return undef;
    }

    my $self = overlay_from_dir($user_id, $dir);
    $self->{id} = $overlay_id;
    if(! $self->{shared}) {
        $self->{owner} = $user_id;
    }
    bless($self);
}


sub delete {
    my $self = shift;
    if($self->{owner} != Bugzilla->user->id
       && !Bugzilla->user->in_group('admin')) {
        ThrowUserError('dashboard_illegal_id');
    }

    my $target_id = $self->{owner};
    if($self->{shared}) {
        $target_id = 0;
    }

    my $dir = get_overlay_dir($target_id, $self->{id});
    remove_tree($dir);
}


sub publish {
    my $self = shift;
    if(! $self->{pending}) {
        return;
    } elsif(! Bugzilla->user->in_group('admin')) {
        ThrowUserError('dashboard_illegal_id');
    }

    $self->{pending} = 0;
    $self->save();
}


sub clone {
    my ($self, $new_id) = @_;

    my $new = $self->from_hash($self);
    $new->{shared} = 0;
    $new->{owner} = int(Bugzilla->user->id);
    $new->{created} = time;
    $new->{id} = to_int($new_id);
    $new->{workspace} = 1;
    $new->save();
}


sub save {
    my $self = shift;

    if(! $self->{created}) {
        $self->{created} = time;
    }

    if(! $self->{owner}) {
        $self->{owner} = int(Bugzilla->user->id);
    }

    if($self->{owner} != Bugzilla->user->id
       && !Bugzilla->user->in_group('admin')) {
        ThrowUserError('dashboard_illegal_id');
    }

    my $target_id = $self->{shared} ? 0 : $self->{owner};
    if(! $self->{id}) {
        $self->{id} = first_free_id(get_overlays_dir($target_id));
    }

    $self->{modified} = time;
    $self->{pending} = $self->{shared} && !Bugzilla->user->in_group('admin');

    my $dir = get_overlay_dir($target_id, $self->{id});
    overlay_to_dir($dir, $self);
    $self;
}


sub update_from {
    my ($self, $hash) = @_;

    my $other = $self->from_hash($hash);
    delete @$other{qw(created owner id)};

    while(my ($key, $value) = each(%$other)) {
        $self->{$key} = $value;
    }
}


1;
