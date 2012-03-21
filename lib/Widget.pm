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
# The Original Code is the Unified Dashboard Bugzilla Extension.
#
# The Initial Developer of the Original Code is "Pami Ketolainen"
# Portions created by the Initial Developer are Copyright (C) 2012 the
# Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   Pami Ketolainen <pami.ketolainen@gmail.com>
#

use strict;

package Bugzilla::Extension::Dashboard::Widget;

use base qw(Bugzilla::Object);

use JSON;

use constant DB_TABLE => 'dashboard_widgets';

use constant DB_COLUMNS => qw(
    id
    name
    overlay_id
    type
    color
    col
    pos
    height
    minimized
    refresh
    data
);

use constant REQUIRED_CREATE_FIELDS => qw(
    name
    type
    overlay_id
);

use constant UPDATE_COLUMNS => qw(
    name
    color
    col
    pos
    height
    minimized
    refresh
    data
);

use constant NUMERIC_COLUMNS => qw(
    overlay_id
    col
    pos
    height
    minimized
    refresh
);

use constant VALIDATORS => {
    minimized => \&Bugzilla::Object::check_boolean,
};

use constant LIST_ORDER => 'pos';

#############
# Accessors #
#############

sub type       { return $_[0]->{'type'}; }
sub color      { return $_[0]->{'color'}; }
sub col        { return $_[0]->{'col'}; }
sub pos        { return $_[0]->{'pos'}; }
sub height     { return $_[0]->{'height'}; }
sub minimized  { return $_[0]->{'minimized'}; }
sub refresh    { return $_[0]->{'refresh'}; }
sub overlay_id { return $_[0]->{'overlay_id'}; }

sub overlay {
    my $self = shift;
    $self->{'overlay'} ||= Bugzilla::Extension::Dashboard::Overlay->new(
        $self->overlay_id);
    return $self->{'overlay'};
}

sub data {
    my $self = shift;
    my $data = $self->{'data'};
    $data = "null" unless defined $data;
    $self->{'parsed_data'} ||= JSON->new->utf8->decode($data);
    return $self->{'parsed_data'};
}

############
# Mutators #
############

sub set_name      { $_[0]->set('name', $_[1]); }
sub set_type      { $_[0]->set('type', $_[1]); }
sub set_color     { $_[0]->set('color', $_[1]); }
sub set_col       { $_[0]->set('col', $_[1]); }
sub set_pos       { $_[0]->set('pos', $_[1]); }
sub set_height    { $_[0]->set('height', $_[1]); }
sub set_minimized { $_[0]->set('minimized', $_[1]); }
sub set_refresh   { $_[0]->set('refresh', $_[1]); }

# These are here so that we can just pass nice hash to set_all
sub set_overlay_id { }

sub set_data {
    my ($self, $data) = @_;
    $self->set('data', JSON->new->utf8->encode($data));
    $self->{'parsed_data'} = $data;
}

##############
# Validators #
##############


###########
# Methods #
###########

sub create {
    my ($class, $params) = @_;
    # set some defaults
    $params->{color} ||= "grey";

    my $data = delete $params->{data};
    $data = {} unless defined $data;
    if(ref($data)) {
        $data = JSON->new->utf8->encode($data);
    }
    $params->{data} = $data;
    return $class->SUPER::create($params);
}

sub update {
    my $self = shift;
    my($changes, $old) = $self->SUPER::update(@_);
    if (scalar(keys %$changes)) {
        $self->overlay->_update_modified_ts();
    }
    return $changes;
}

sub user_is_owner {
    my $self = shift;
    my $user = Bugzilla->user;
    return 0 unless defined $user;
    return $user->id == $self->overlay->owner_id;
}
1;
