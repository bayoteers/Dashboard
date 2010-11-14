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
use base qw(Bugzilla::Extension);

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;
use Bugzilla::User;

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

    my $user_id = Bugzilla->user->id;

    my $datadir     = bz_locations()->{'datadir'};
    my $dataextdir  = $datadir . EXTENSION_DIR;
    my $datauserdir = $dataextdir . '/' . $user_id;

    if ( $user_id > 0 ) {
      my $cgi = Bugzilla->cgi;
      
      # Get users preferences or create defaults if the user is new
      if ( -d $datauserdir && -e $datauserdir . "/preferences" ) {
        $vars->{preferences} = retrieve( $datauserdir . "/preferences" );

      }
      else {

        # new user, create prefs folder

        mkpath( $datauserdir, { verbose => 0, mode => 0755, error => \my $err } );

        if (@$err) {
          for my $diag (@$err) {
            my ( $file, $message ) = each %$diag;
            print "Problem making $file: $message\n";
          }
          die("Couldn't create $datauserdir");

        }

        # create default preferences
        my %preferences->{columns} = COLUMNS_DEFAULT;
        store \%preferences, $datauserdir . "/preferences";
        $vars->{preferences} = \%preferences;
      }

      $vars->{cgi_variables} = { Bugzilla->cgi->Vars };

      if ( $page eq "dashboard_ajax.html" ) {

        if ( Bugzilla->cgi->param('action') eq 'column_add' ) {
          my $last_col = $vars->{preferences}->{columns};
          $last_col++;
          if ( $last_col < COLUMNS_MAX ) {
            $vars->{preferences}->{columns} = $last_col;
            $vars->{widget_ajax} = "\$('#columns').append('<ul id=\"column$last_col\" class=\"column\"></ul>');\$(window).trigger(\"resize\");Dashboard.makeSortable();";
            store $vars->{preferences}, $datauserdir . "/preferences";
          }
          else {
            $vars->{widget_error} = 'Cannot create new column, maximum reached!';
          }

        }
        elsif ( Bugzilla->cgi->param('action') eq 'column_del' ) {

          opendir( DIR, $datauserdir ) or die($!);
          my ( @files, $file );
          my $last_col = 1;
          @files = grep( /\.widget$/, readdir(DIR) );
          closedir(DIR);

          foreach $file (@files) {
            my $widget = retrieve( $datauserdir . "/" . $file );
            if ( $widget->{col} > $last_col ) { $last_col = $widget->{col}; }
          }

          if ( $last_col < $vars->{preferences}->{columns} ) {
            $last_col = $vars->{preferences}->{columns};
            $vars->{widget_ajax} = "\$('#column$last_col').remove();\$(window).trigger(\"resize\");Dashboard.makeSortable();";
            $vars->{preferences}->{columns}--;
            store $vars->{preferences}, $datauserdir . "/preferences";
          }
          elsif ( $last_col > 1 ) {
            $vars->{widget_error} = 'You must remove widgets from the last column before deleting it!';
          }
          else {
            $vars->{widget_error} = 'You cannot delete the last column!';
          }

        }

        elsif ( Bugzilla->cgi->param('action') eq 'new' ) {

          my $widget_id = int( $cgi->param('widget_id') );

          if ( $widget_id > 0 ) {

            opendir( DIR, $datauserdir ) or die($!);
            my ( @files, $file );
            @files = grep( /\.widget$/, readdir(DIR) );
            closedir(DIR);

            if ( scalar @files < WIDGETS_MAX ) {

              trick_taint($widget_id);

              # numerical fields
              my @fields = qw(id pos col height);

              foreach (@fields) {
                $vars->{widget}->{$_} = int( $cgi->param( "widget_" . $_ ) );
              }

              # ascii only fields
              my @fields = qw(type);
              foreach (@fields) {
                $vars->{widget}->{$_} = clean_text( $cgi->param( "widget_" . $_ ) );
              }
              $vars->{widget}->{resized} = 1;
              store $vars->{widget}, $datauserdir . "/" . $widget_id . ".widget";
              $vars->{widget_ajax} = "Dashboard.savePreferences('widget$widget_id');";
            }
            else {
              my @files = glob $datauserdir . "/" . $widget_id . ".*";

              foreach my $dir_entry (@files) {
                trick_taint($dir_entry);
                unlink $dir_entry;
              }
              $vars->{widget_ajax}  = "\$('#widget$widget_id').remove();";
              $vars->{widget_error} = 'Cannot create new widget, maximum number reached!';
            }
          }
          else {
            $vars->{widget_error} = "Cannot create widget, illegal widget id!";
          }
        }
        elsif ( Bugzilla->cgi->param('action') eq 'load' ) {

          my $widget_id = int( $cgi->param('widget_id') );

          if ( $widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget" ) {
            my $widget = retrieve( $datauserdir . "/" . $widget_id . ".widget" );
            $vars->{widget} = $widget;
          }
          else {
            if ( $widget_id > 0 ) {
              $vars->{widget_error} = "Cannot load widget, preferences not found!";
            }
            else {
              $vars->{widget_error} = "Cannot load widget, illegal widget id!";
            }
          }
        }
        elsif ( Bugzilla->cgi->param('action') eq 'delete' ) {

          my $widget_id = int( $cgi->param('widget_id') );

          if ( $widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget" ) {
            my @files = glob $datauserdir . "/" . $widget_id . ".*";

            foreach my $dir_entry (@files) {
              trick_taint($dir_entry);
              unlink $dir_entry;
            }
          }
          else {
            if ( $widget_id > 0 ) {
              $vars->{widget_error} = "Cannot delete widget, preferences not found!";
            }
            else {
              $vars->{widget_error} = "Cannot delete widget, illegal widget id!";
            }

          }
        }
        elsif ( Bugzilla->cgi->param('action') eq 'save' ) {

          my $widget_id = int( $cgi->param('widget_id') );

          if ( $widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget" ) {
            trick_taint($widget_id);

            #my (%widget);
            my $widget = retrieve( $datauserdir . "/" . $widget_id . ".widget" );

            # numerical fields
            my @fields = qw(id pos col height refresh);

            foreach (@fields) {
              $widget->{$_} = int( $cgi->param( "widget_" . $_ ) );
            }

            # true/false fields
            my @fields = qw(movable removable collapsible editable resizable resized maximizable minimized controls refreshable);

            foreach (@fields) {
              $widget->{$_} = $cgi->param( "widget_" . $_ ) eq 'true' ? 1 : 0;
            }

            # text fields
            my @fields   = qw(title URL);
            my $scrubber = HTML::Scrubber->new;
            $scrubber->default(0);

            foreach (@fields) {
              $widget->{$_} = $scrubber->scrub( $cgi->param( "widget_" . $_ ) );
            }

            # color
            $widget->{'color'} = $cgi->param("widget_color") =~ /color-(gray|yellow|red|blue|white|orange|green)/ ? $1 : "gray";

            store $widget, $datauserdir . "/" . $widget_id . ".widget";
          }
          else {

            $vars->{widget_error} = "Cannot save widget, illegal widget id!";

          }
        }
      }
      else {
        for ( my $i = 0 ; $i <= $vars->{preferences}->{columns} ; $i++ ) {

          $vars->{"columns"}->[$i][0];
        }

        opendir( DIR, $datauserdir ) or die($!);
        my ( @files, $file );
        @files = grep( /\.widget$/, readdir(DIR) );
        closedir(DIR);
        foreach $file (@files) {
          my $widget = retrieve( $datauserdir . "/" . $file );
          $vars->{"columns"}->[ $widget->{col} ]->[ $widget->{pos} ] = $widget;
        }

      }
    }
    else {
      ThrowUserError('login_required');
    }
  }
}

__PACKAGE__->NAME;
