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
# The Initial Developer of the Original Code is YOUR NAME
# Portions created by the Initial Developer are Copyright (C) 2010 the
# Initial Developer. All Rights Reserved.
#
# Contributor(s):
#   Jari Savolainen <ext-jari.a.savolainen@nokia.com>
#   Stephen Jayna <ext-stephen.jayna@nokia.com>

package Bugzilla::Extension::Dashboard;
use strict;
use base qw(Bugzilla::Extension);

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;

# This code for this is in ./extensions/Dashboard/lib/Util.pm
use Bugzilla::Extension::Dashboard::Util;

# For input sanitization
use HTML::Scrubber;

# For serialization
use Storable;

use File::Path;

our $VERSION = '0.01';

# See the documentation of Bugzilla::Hook ("perldoc Bugzilla::Hook"
# in the bugzilla directory) for a list of all available hooks.
sub install_update_db {
  my ( $self, $args ) = @_;
}

# Hook for page.cgi and dashboard
sub page_before_template {
  my ( $self, $args ) = @_;
  my ( $vars, $page ) = @$args{qw(vars page_id)};

  if ( $page =~ /^dashboard(_ajax)?\.(html|js)/ ) {
    $vars->{debug_info} = "Hooked page";

    my $user_id = Bugzilla->user->id;

    my $datadir     = bz_locations()->{'datadir'};
    my $dataextdir  = $datadir . '/extensions/Dashboard';
    my $datauserdir = $dataextdir . '/' . $user_id;

    if ( $user_id > 0 ) {
      my $cgi = Bugzilla->cgi;

      $vars->{debug_info} .= " | user_id: " . $user_id;
      $vars->{debug_info} .= " | datauserdir: " . $datauserdir;

      if ( -d $datauserdir ) {

        # old user, load prefs folder
        $vars->{debug_info} .= '| old user';
      }
      else {

        # new user, create prefs folder
        $vars->{debug_info} .= '| new user';

        mkpath( $datauserdir, { verbose => 0, mode => 0755, error => \my $err } );

        if (@$err) {
          for my $diag (@$err) {
            my ( $file, $message ) = each %$diag;
            print "Problem making $file: $message\n";
          }
          die("Couldn't create $datauserdir");
        }
      }

      $vars->{cgi_variables} = { Bugzilla->cgi->Vars };

      if ( $page eq "dashboard_ajax.html" ) {
        $vars->{debug_info} .= " | widget";

        if ( Bugzilla->cgi->param('action') eq 'load' ) {
          $vars->{debug_info} .= " | load";

          $vars->{debug_info} .= " | " . Bugzilla->cgi->param('widget_id');
          my $widget_id = int( $cgi->param('widget_id') );

          if ( $widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget" ) {
            my $widget = retrieve( $datauserdir . "/" . $widget_id . ".widget" );
            $vars->{widget} = $widget;
          }
          else {
            $vars->{debug_info} .= " | illegal widget id";
          }
        }
        elsif ( Bugzilla->cgi->param('action') eq 'delete' ) {
          $vars->{debug_info} .= " | delete";

          $vars->{debug_info} .= " | " . Bugzilla->cgi->param('widget_id');
          my $widget_id = int( $cgi->param('widget_id') );

          if ( $widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget" ) {
            my @files = glob $datauserdir . "/" . $widget_id . ".*";

            foreach my $dir_entry (@files) {
              trick_taint($dir_entry);
              unlink $dir_entry;
              $vars->{debug_info} .= " | " . $dir_entry . " deleted";
            }
          }
          else {
            $vars->{debug_info} .= " | illegal widget id";
          }
        }
        elsif ( Bugzilla->cgi->param('action') eq 'save' ) {
          $vars->{debug_info} .= " | save";

          $vars->{debug_info} .= " | " . Bugzilla->cgi->param('widget_id');
          my $widget_id = int( $cgi->param('widget_id') );

          if ( $widget_id > 0 ) {
            trick_taint($widget_id);

            my (%widget);

            # numerical fields
            my @fields = qw(id pos col height);

            foreach (@fields) {
              %widget->{$_} = int( $cgi->param( "widget_" . $_ ) );
            }

            # true/false fields
            my @fields = qw(movable removable collapsible editable resizable resized maximizable minimized);

            foreach (@fields) {
              %widget->{$_} = $cgi->param( "widget_" . $_ ) eq 'true' ? 1 : 0;
            }

            # text fields
            my @fields   = qw(title);
            my $scrubber = HTML::Scrubber->new;
            $scrubber->default(0);

            foreach (@fields) {
              %widget->{$_} = $scrubber->scrub( $cgi->param( "widget_" . $_ ) );
            }

            # color
            %widget->{'color'} = $cgi->param("widget_color") =~ /color-(gray|yellow|red|blue|white|orange|green)/ ? $1 : "gray";

            foreach my $key ( sort keys %widget ) {
              $vars->{debug_info} .= ", $key=" . %widget->{$key};
            }

            store \%widget, $datauserdir . "/" . $widget_id . ".widget";
          }
          else {
            $vars->{debug_info} .= " | illegal widget id";
          }
        }
      }
      else {
        opendir( DIR, $datauserdir ) or die($!);
        my ( @files, $file );
        @files = grep( /\.widget$/, readdir(DIR) );
        closedir(DIR);

        foreach $file (@files) {
          $vars->{debug_info} .= " | " . $file;
          my $widget = retrieve( $datauserdir . "/" . $file );
          $vars->{ "column" . $widget->{col} }->[ $widget->{pos} ] = $widget;
        }

        $vars->{debug_info} .= " | default";
      }
    }
    else {
      ThrowUserError('login_required');
    }
  }
}

__PACKAGE__->NAME;
