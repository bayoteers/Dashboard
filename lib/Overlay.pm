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

use base qw(Bugzilla::Object);

use Bugzilla::User;
use Bugzilla::Error;

#use Bugzilla::Extension::Dashboard::Widget;

use JSON;
use List::Util qw(sum);

use constant DB_TABLE => 'dashboard_overlays';

use constant DB_COLUMNS => qw(
    id
    name
    description
    columns
    created
    modified
    owner_id
    pending
    shared
    workspace
);

use constant REQUIRED_CREATE_FIELDS => qw(
    name
);

use constant UPDATE_COLUMNS => qw(
    name
    description
    columns
    modified
    pending
    shared
    workspace
);


use constant NUMERIC_COLUMNS => qw(
    owner_id
    pending
    shared
    workspace
);

use constant DATE_COLUMNS => qw(
    created
    modified
);

use constant VALIDATORS => {
    pending => \&Bugzilla::Object::check_boolean,
    shared => \&Bugzilla::Object::check_boolean,
    workspace => \&Bugzilla::Object::check_boolean,
    columns => \&_check_columns,
};

#############
# Accessors #
#############

sub owner_id    { return $_[0]->{'owner_id'}; }
sub description { return $_[0]->{'description'}; }
sub created     { return $_[0]->{'created'}; }
sub modified    { return $_[0]->{'modified'}; }
sub pendind     { return $_[0]->{'pending'}; }
sub shared      { return $_[0]->{'shared'}; }
sub workspace   { return $_[0]->{'workspace'}; }

sub owner {
    my $self = shift;
    $self->{'owner'} ||= Bugzilla::User->new($self->owner_id);
    return $self->{'owner'};
}

sub columns {
    my $self = shift;
    $self->{'column_list'} ||= JSON->new->utf8->decode($self->{'columns'});
    return $self->{'column_list'};
}

sub widgets {
    my $self = shift;
    $self->{'widgets'} ||= Bugzilla::Extension::Dashboard::Widget->match(
        {overlay_id => $self->id});
    return $self->{'widgets'};
}

############
# Mutators #
############

sub set_description { $_[0]->set('description', $_[1]); }
sub set_created     { $_[0]->set('created', $_[1]); }
sub set_modified    { $_[0]->set('modified', $_[1]); }
sub set_pending     { $_[0]->set('pending', $_[1]); }
sub set_shared      { $_[0]->set('shared', $_[1]); }
sub set_workspace   { $_[0]->set('workspace', $_[1]); }
sub set_columns     { $_[0]->set('columns', $_[1]); }

sub set_owner {
    my ($self, $owner) = @_;
    if (! ref($owner) eq 'Bugzilla::User') {
        $owner = Bugzilla::User->new($owner);
    }
    $self->set('owner_id', $owner->{id});
    $self->{owner} = $owner;
}

##############
# Validators #
##############

sub _check_columns {
    my ($invocant, $columns) = @_;
    ThrowCodeError("zero_columns_in_overlay") if (! @{$columns});

    # If column totals don't add up to 100%, spread the difference out.
    my $total = sum map { $_->{width} } @{ $columns };
    my $delta = int((100 - $total) / @{ $columns });
    map { $_->{width} += $delta } @{ $columns };

    return JSON->new->utf8->encode($columns);
}

###########
# Methods #
###########

sub create {
    my ($class, $params) = @_;

    # 'created', 'modified' and 'owner_id' can't be set by the caller
    $params->{created} = Bugzilla->dbh->selectrow_array(
        'SELECT LOCALTIMESTAMP(0)');
    $params->{modified} = $params->{created};
    $params->{owner_id} = Bugzilla->user->id;

    # Set default columns if not provided
    if (!$params->{columns}) {
        $params->{columns} = [
            {width => 33},
            {width => 33},
            {width => 33},
        ];
    }

    my @widgets = @{delete $params->{widgets}};
    my $overlay = $class->SUPER::create($params);

    # Create widgets if provided
    foreach my $widget (@widgets) {
        $widget->{overlay_id} = $overlay->id;
        $widget = Bugzilla::Extension::Dashboad::Widget->create($widget);
        push(@{$overlay->{widgets}}, $widget);
    }
    return $overlay;
}

## Old storable stuff
#
#sub from_hash {
#    my ($class, $hash) = @_;
#    my $self = parse(OVERLAY_DEFS, $hash);
#    bless($self);
#}
#
#
#sub from_store {
#    my ($class, $user_id, $overlay_id) = @_;
#
#    $user_id = to_int($user_id);
#    $overlay_id = to_int($overlay_id);
#
#    # Ensure current user has right to open overlay.
#    if($user_id && $user_id != Bugzilla->user->id
#       && !Bugzilla->user->in_group('admin')) {
#        ThrowUserError('dashboard_illegal_id');
#    }
#
#    my $dir = get_overlay_dir($user_id, $overlay_id);
#    if(!-d $dir || !scalar dir_glob($dir, '*')) {
#        return undef;
#    }
#
#    my $self = overlay_from_dir($user_id, $dir);
#    $self->{id} = $overlay_id;
#    if(! $self->{shared}) {
#        $self->{owner} = $user_id;
#    }
#    bless($self);
#}
#
#
#sub delete {
#    my $self = shift;
#    if($self->{owner} != Bugzilla->user->id
#       && !Bugzilla->user->in_group('admin')) {
#        ThrowUserError('dashboard_illegal_id');
#    }
#
#    my $target_id = $self->{owner};
#    if($self->{shared}) {
#        $target_id = 0;
#    }
#
#    my $dir = get_overlay_dir($target_id, $self->{id});
#    remove_tree($dir);
#}
#
#
#sub publish {
#    my $self = shift;
#    if(! $self->{pending}) {
#        return;
#    } elsif(! Bugzilla->user->in_group('admin')) {
#        ThrowUserError('dashboard_illegal_id');
#    }
#
#    $self->{pending} = 0;
#    $self->save();
#}
#
#
#sub clone {
#    my ($self, $new_id) = @_;
#
#    my $new = $self->from_hash($self);
#    $new->{shared} = 0;
#    $new->{owner} = int(Bugzilla->user->id);
#    $new->{created} = time;
#    $new->{id} = to_int($new_id);
#    $new->{workspace} = 1;
#    $new->save();
#}
#
#
#sub save {
#    my $self = shift;
#
#    if(! $self->{created}) {
#        $self->{created} = time;
#    }
#
#    if(! $self->{owner}) {
#        $self->{owner} = int(Bugzilla->user->id);
#    }
#
#    if($self->{owner} != Bugzilla->user->id
#       && !Bugzilla->user->in_group('admin')) {
#        ThrowUserError('dashboard_illegal_id');
#    }
#
#    my $target_id = $self->{shared} ? 0 : $self->{owner};
#    if(! $self->{id}) {
#        $self->{id} = first_free_id(get_overlays_dir($target_id));
#    }
#
#    $self->{modified} = time;
#    $self->{pending} = $self->{shared} && !Bugzilla->user->in_group('admin');
#
#    my $dir = get_overlay_dir($target_id, $self->{id});
#    overlay_to_dir($dir, $self);
#    $self;
#}
#
#
#sub update_from {
#    my ($self, $hash) = @_;
#
#    my $other = $self->from_hash($hash);
#    delete @$other{qw(created owner id)};
#
#    while(my ($key, $value) = each(%$other)) {
#        $self->{$key} = $value;
#    }
#}


1;
