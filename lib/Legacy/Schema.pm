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
# The Initial Developer of the Original Code is "Nokia Corporation"
# Portions created by the Initial Developer are Copyright (C) 2010 the
# Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   David Wilson <ext-david.3.wilson@nokia.com>
#

package Bugzilla::Extension::Dashboard::Legacy::Schema;

use strict;
use Exporter 'import';
use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Util;
use HTML::Scrubber;

our @EXPORT = qw(
    COLUMN_DEFS
    OVERLAY_DEFS
    parse
    to_bool
    to_color
    to_int
    to_text
    WIDGET_DEFS
);

use constant WIDGET_DEFS => {
    # Background colour.
    color => { type => 'color', required => 1, default => 'gray' },
    # Integer 0..cols widget column number.
    col => { type => 'int', required => 1 },
    # Widget height in pixels.
    height => { type => 'int' },
    # Widget ID
    id => { type => 'int', required => 1, min => 1 },
    # Bool 0..1, widget content is hidden.
    minimized => { type => 'bool' },
    # Password for RSS widget.
    password => { type => 'text', private => 1 },
    # Integer 0..rows widget position in column.
    pos => { type => 'int', required => 1 },
    # Refresh interval in seconds.
    refresh => { type => 'int', default => 600, required => 1 },
    # CSS selector for URL widget.
    selector => { type => 'text' },
    # Widget title.
    title => { type => 'text', required => 1 },
    # Contents of 'text' widget.
    text => { type => 'text' },
    # Type, one of 'url', 'rss', 'mybugs'.
    type => { type => 'text', required => 1, choices => [ WIDGET_TYPES ]},
    # URL for 'url' widget.
    URL => { type => 'text' },
    # Username for 'rss' widget.
    username => { type => 'text', private => 1 }
};

use constant COLUMN_DEFS => {
    # Width in percent.
    width => { type => 'int', required => 1 }
};

use constant OVERLAY_DEFS => {
    # List of columns.
    columns => { type => 'list', item => COLUMN_DEFS, required => 1 },
    # Seconds since epoch creation time.
    created => { type => 'int' },
    # Long description.
    description => { type => 'text', required => 1, default => '' },
    # Overlay ID, unique per user_id.
    id => { type => 'int' },
    # Seconds since epoch last save time.
    modified => { type => 'int' },
    # Short name.
    name => { type => 'text', required => 1, min_length => 4 },
    # Owner user ID.
    owner => { type => 'int', },
    # Shared overlay hasn't been approved yet?
    pending => { type => 'int', default => 0 },
    # Shared between all users?
    shared => { type => 'bool', default => 0, required => 1 },
    # User login. Only appears in get_overlays list.
    user_login => { type => 'text' },
    # User ID. '0' for shared overlays, otherways same as 'owner' field.
    user_id => { type => 'int' },
    # List of widgets.
    widgets => { type => 'list', item => WIDGET_DEFS },
    # Bool, overlay represents a user's workspace.
    workspace => { type => 'bool', default => 0 },
};

use constant TYPE_CONVERTER_MAP => {
    int => \&to_int,
    bool => \&to_bool,
    text => \&to_text,
    color => \&to_color,
};


sub _parse_field {
    my ($field, $def, $value) = @_;

    if(defined($def->{min}) && $value < $def->{min}) {
        my $min = $def->{min};
        die "Field '$field' must be at least $min.";
    } elsif(defined($def->{min_length}) && length($value) < $def->{min_length}) {
        my $min = $def->{min_length};
        die "Field '$field' must be at least $min long.";
    } elsif(defined($def->{default}) && !defined($value)) {
        $value = $def->{default};
    } elsif($def->{required} && !defined($value)) {
        die 'Missing required field: ' . $field;
    } elsif($def->{choices} && defined($value)
            && !grep($_ eq $value, @{$def->{choices}})) {
        my $choices = join(', ', @{$def->{choices}});
        die "Field $field invalid value '$value'; ".
            "must be one of $choices";
    }

    my $converter = TYPE_CONVERTER_MAP->{$def->{type}};
    return &$converter($value);
}

sub _parse_list {
    my ($field, $def, $value) = @_;

    if($def->{required} && !defined($value)) {
        die "Field '$field' is required and must be an array.";
    } elsif(! defined($value)) {
        return [];
    } elsif(! UNIVERSAL::isa($value, 'ARRAY')) {
        die "Field '$field' must be an array.";
    }

    return [ map { parse($def->{item}, $_) } @$value ];
}

sub parse {
    my ($defs, $fields, $check_required) = @_;

    my $out = {};
    while(my ($field, $def) = each(%$defs)) {
        my $value = $fields->{$field};

        if($def->{type} eq 'list') {
            $out->{$field} = _parse_list($field, $def, $value);
        } else {
            $out->{$field} = _parse_field($field, $def, $value);
        }
    }

    return $out;
}


#
# Type conversion functions.
#

sub to_int {
    my ($s) = @_;
    detaint_signed($s);
    return int($s || 0);
}

sub to_bool {
    my ($s) = @_;
    $s ||= '';
    return int($s eq 'true' || ($s =~ /\d+/ && $s == 1));
}

sub to_text {
    my ($s, $default) = @_;
    if ($s) {
        my $scrubber = HTML::Scrubber->new;
        $scrubber->default(0);
        return trim($scrubber->scrub($s));
    }
    return trim($default || '');
}

sub to_color {
    my ($s) = @_;
    $s ||= '';

    if($s =~ /^(?:color-)?(gray|yellow|red|blue|white|orange|green)$/) {
        return $1;
    }

    return 'gray';
}


1;
