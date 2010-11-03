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
#   YOUR NAME <YOUR EMAIL ADDRESS>

package Bugzilla::Extension::Dashboard;
use strict;
use base qw(Bugzilla::Extension);

use Bugzilla::Constants;
use Bugzilla::Error;
use Bugzilla::Util;

# This code for this is in ./extensions/Dashboard/lib/Util.pm
use Bugzilla::Extension::Dashboard::Util;

# For serialization
#use Tie::File;
use Storable;

our $VERSION = '0.01';

# See the documentation of Bugzilla::Hook ("perldoc Bugzilla::Hook" 
# in the bugzilla directory) for a list of all available hooks.
sub install_update_db {
    my ($self, $args) = @_;
}

# Hook for page.cgi and dashboard
sub page_before_template {
  my ($self, $args) = @_;
  my ($vars, $page) = @$args{qw(vars page_id)};

  if ($page =~ /^dashboard(_ajax)?\.(html|js)/ ) {
    $vars->{debug_info} = "Hooked page";
    
    my $user_id = Bugzilla->user->id;
    
    my $datadir = bz_locations()->{'datadir'};
    my $dataextdir = $datadir . '/extensions/Dashboard';
    my $datauserdir = $dataextdir . '/' . $user_id;
    
    if ($user_id>0) {
      
      my $cgi = Bugzilla->cgi;
      
      $vars->{debug_info} .= " | user_id: " . $user_id;
      $vars->{debug_info} .= " | datauserdir: " . $datauserdir;
      
      if (-d $datauserdir) {
        ## old user, load prefs folder
        $vars->{debug_info} .= '| old user';
      } else {
        ## new user, create prefs folder
        $vars->{debug_info} .= '| new user';
        mkdir $datauserdir, 0755;
      }
      
      $vars->{cgi_variables} = { Bugzilla->cgi->Vars };
      if ($page eq "dashboard_ajax.html") {
        $vars->{debug_info} .= " | widget";
        if (Bugzilla->cgi->param('action') eq 'save') {
          $vars->{debug_info} .= " | save";
          
          $vars->{debug_info} .= " | " . Bugzilla->cgi->param('widget_id');
          my $widget_id = $cgi->param('widget_id');
          trick_taint($widget_id);
          
          my %widget = (
            'widget_id' => int($cgi->param('widget_id')),
            'widget_pos' => int($cgi->param('widget_pos')),
            'widget_col' => int($cgi->param('widget_col'))
          );
          store \%widget, $datauserdir . "/" . $widget_id . ".widget";
        }
      } else {
        opendir(DIR, $datauserdir);
        my (@files,$file);
        @files = grep(/\.widget$/,readdir(DIR));
        closedir(DIR);
        foreach $file (@files) {
          $vars->{debug_info} .= " | " . $file;
          my $widget = retrieve($datauserdir . "/" . $file);
          
          $vars->{debug_info} .= "," . $widget->{widget_id};
          $vars->{debug_info} .= "," . $widget->{widget_pos};
          $vars->{debug_info} .= "," . $widget->{widget_col};
          
          $vars->{"column".$widget->{widget_col}}->[$widget->{widget_pos}] = $widget;
        }
        $vars->{debug_info} .= " | default";
      }
      
    } else {
      ThrowUserError('login_required'); 
    }        
  }
}

__PACKAGE__->NAME;