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
use Bugzilla::Extension::Dashboard::Config;
use Bugzilla::Extension::Dashboard::Util;

# For input sanitization
use HTML::Scrubber;

# For serialization
use Storable;

# For RSS proxy
use LWP;

# Core modules
use File::Path;
use File::Basename;
use File::Copy;
use List::Util;
use POSIX qw(strftime);

our $VERSION = '0.01';

# See the documentation of Bugzilla::Hook ("perldoc Bugzilla::Hook"
# in the bugzilla directory) for a list of all available hooks.
sub install_update_db {
    my ($self, $args) = @_;
}

# widget subs

# delete all widget_id related files and return ajax to fade/slide/close the widget
sub _delete_widget {
    my ($widget_id, $datauserdir, $vars) = @_;
    if ($widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget") {
        my @files = glob $datauserdir . "/" . $widget_id . ".*";

        foreach my $dir_entry (@files) {
            trick_taint($dir_entry);
            unlink $dir_entry;
        }

        # on success jquery hides widget element, slides it to 0 height and removes it from the page
        $vars->{widget_ajax} =
"\$('#widget$widget_id').animate({ opacity: 0 }, function() {\$('#widget$widget_id').wrap('<div/>').parent().slideUp(function() {\$('#widget$widget_id').remove();});});";

    }
    else {
        if ($widget_id > 0) {
            $vars->{widget_error} = "Cannot delete widget, preferences not found!";
        }
        else {
            $vars->{widget_error} = "Cannot delete widget, illegal widget id!";
        }

    }
}

# load widget specific preferences
sub _load_widget {
    my ($widget_id, $datauserdir, $vars) = @_;
    if ($widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget") {
        my $widget = retrieve($datauserdir . "/" . $widget_id . ".widget");
        $vars->{widget} = $widget;
    }
    else {
        if ($widget_id > 0) {
            $vars->{widget_error} = "Cannot load widget, preferences not found!";
        }
        else {
            $vars->{widget_error} = "Cannot load widget, illegal widget id!";
        }
    }

}

# create new widget and store all required preferences
sub _new_widget {
    my ($widget_id, $datauserdir, $vars) = @_;

    if ($widget_id > 0) {

        opendir(DIR, $datauserdir) or die($!);
        my (@files, $file);
        @files = grep(/\.widget$/, readdir(DIR));
        closedir(DIR);

        # if widget can be created, get required prefences, store them and tell jquery to save any extra preferences the widget has
        if (scalar @files < WIDGETS_MAX) {

            my $cgi = Bugzilla->cgi;
            my @fields;

            trick_taint($widget_id);

            # numerical fields
            # each widget MUST have unique id, position (vertical), column it is and height of the widget
            @fields = qw(id pos col height);

            foreach (@fields) {
                $vars->{widget}->{$_} = int($cgi->param("widget_" . $_));
            }

            # ascii only fields
            # todo: add type verification based on installed widget types
            @fields = qw(type);
            foreach (@fields) {
                $vars->{widget}->{$_} = clean_text($cgi->param("widget_" . $_));
            }

            # force the widget to be resized on load
            $vars->{widget}->{resized} = 1;
            store $vars->{widget}, $datauserdir . "/" . $widget_id . ".widget";
            $vars->{widget_ajax} = "Dashboard.savePreferences('widget$widget_id');";
        }
        else {

            # in case of too many widgets, delete widget prefs and tell jquery to remove the widget stub from the UI
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

# get and store all extended widget preferences
sub _save_widget {
    my ($widget_id, $datauserdir, $vars) = @_;

    if ($widget_id > 0 && -e $datauserdir . "/" . $widget_id . ".widget") {
        trick_taint($widget_id);
        my $cgi = Bugzilla->cgi;
        my @fields;
        my $widget = retrieve($datauserdir . "/" . $widget_id . ".widget");

        # numerical fields
        @fields = qw(id pos col height refresh);

        foreach (@fields) {

            $widget->{$_} = int(
                                  $cgi->param("widget_" . $_)
                                ? $cgi->param("widget_" . $_)
                                : 0
                               );
        }

        # true/false fields
        @fields = qw(movable removable collapsible editable resizable resized maximizable minimized controls refreshable);

        foreach (@fields) {
            $widget->{$_} = $cgi->param("widget_" . $_) eq 'true' ? 1 : 0;
        }

        # text fields
        @fields = qw(title URL username password);
        my $scrubber = HTML::Scrubber->new;
        $scrubber->default(0);

        foreach (@fields) {
            $widget->{$_} =
                $cgi->param("widget_" . $_)
              ? $scrubber->scrub($cgi->param("widget_" . $_))
              : " ";
        }

        # color
        $widget->{'color'} = $cgi->param("widget_color") =~ /color-(gray|yellow|red|blue|white|orange|green)/ ? $1 : "gray";

        store $widget, $datauserdir . "/" . $widget_id . ".widget";
    }
    else {

        $vars->{widget_error} = "Cannot save widget, illegal widget id!";

    }

}

# delete last column if it is empty and re-init the Sortable UI on success
sub _delete_column {
    my ($datauserdir, $vars) = @_;

    # load all widgets and find out the last column used
    opendir(DIR, $datauserdir) or die($!);
    my (@files, $file);
    my $last_col = 1;
    @files = grep(/\.widget$/, readdir(DIR));
    closedir(DIR);

    foreach $file (@files) {
        my $widget = retrieve($datauserdir . "/" . $file);
        if ($widget->{col} > $last_col) { $last_col = $widget->{col}; }
    }

# if column can be deleted, decrease and save the column setting and tell jquery to remove the last column, resize widgets and call makeSortable() to re-init the Sortable UI elements
    if ($last_col < $vars->{preferences}->{columns}) {
        $last_col = $vars->{preferences}->{columns};
        $vars->{widget_ajax} = "\$('#column$last_col').remove();\$(window).trigger(\"resize\");Dashboard.makeSortable();";
        $vars->{preferences}->{columns}--;
        store $vars->{preferences}, $datauserdir . "/preferences";
    }
    elsif ($last_col > 1) {
        $vars->{widget_error} = 'You must remove widgets from the last column before deleting it!';
    }
    else {
        $vars->{widget_error} = 'You cannot delete the last column!';
    }
}

# add new column and re-init the Sortable UI on success
sub _add_column {
    my ($datauserdir, $vars) = @_;

    my $last_col = $vars->{preferences}->{columns};
    $last_col++;

    # if new column can be added, tell jquery to create new UL element for the column and call makeSortable() to re-init the Sortable UI elements
    if ($last_col < COLUMNS_MAX) {
        $vars->{preferences}->{columns} = $last_col;
        $vars->{widget_ajax} =
          "\$('#columns').append('<ul id=\"column$last_col\" class=\"column\"></ul>');\$(window).trigger(\"resize\");Dashboard.makeSortable();";
        store $vars->{preferences}, $datauserdir . "/preferences";
    }
    else {
        $vars->{widget_error} = 'Cannot create new column, maximum reached!';
    }

}

# save the widths of the columns in percentages
sub _save_columns {
    my ($datauserdir, $vars) = @_;

    my $cgi = Bugzilla->cgi;

    for (my $i = 0 ; $i <= $vars->{preferences}->{columns} ; $i++) {
        $vars->{preferences}->{ "column" . $i } = int($cgi->param("column" . $i) ? $cgi->param("column" . $i) : 0);
    }

    store $vars->{preferences}, $datauserdir . "/preferences";
}

# Hook for page.cgi and dashboard
sub page_before_template {
    my ($self, $args) = @_;
    my ($vars, $page) = @$args{qw(vars page_id)};

    if ($page =~ /^dashboard(_ajax|_overlay|_rss)?\.html$/) {

        my $user_id = Bugzilla->user->id;

        if (Bugzilla->params->{"dashboard_jquery_path"}) {
            $vars->{dashboard_jquery_path} = Bugzilla->params->{"dashboard_jquery_path"};
        }

        my $datadir     = bz_locations()->{'datadir'};
        my $dataextdir  = $datadir . EXTENSION_DIR;
        my $datauserdir = $dataextdir . '/' . $user_id;

        if ($user_id > 0) {
            my $cgi = Bugzilla->cgi;

            # force http cache to be expired
            print $cgi->header(-expires       => 'Sat, 26 Jul 1997 05:00:00 GMT');
            print $cgi->header(-Last_Modified => strftime('%a, %d %b %Y %H:%M:%S GMT', gmtime));
            print $cgi->header(-Pragma        => 'no-cache');
            print $cgi->header(-Cache_Control => join(', ', qw(private no-cache no-store must-revalidate max-age=0 pre-check=0 post-check=0)));

            # Get users preferences or create defaults if the user is new
            if (-d $datauserdir && -f $datauserdir . "/preferences") {
                $vars->{preferences} = retrieve($datauserdir . "/preferences");
            }
            else {

                # new user, create prefs folder

                mkpath($datauserdir, { verbose => 0, mode => 0755, error => \my $err });

                if (@$err) {
                    for my $diag (@$err) {
                        my ($file, $message) = each %$diag;
                        print "Problem making $file: $message\n";
                    }
                    die("Couldn't create $datauserdir");
                }

                # create default preferences
                my $preferences;
                $preferences->{columns} = COLUMNS_DEFAULT;
                for (my $i = 0 ; $i < COLUMNS_DEFAULT ; $i++) {
                    $preferences->{ "column" . $i } = int(100 / COLUMNS_DEFAULT);
                }
                store $preferences, $datauserdir . "/preferences";
                $vars->{preferences} = $preferences;
            }

            $vars->{cgi_variables} = { Bugzilla->cgi->Vars };

            # ajax calls, extension can return javascript with 'widget_ajax' and error messages with 'widget_error'
            if ($page eq "dashboard_ajax.html") {

                my @fields;

                if (Bugzilla->cgi->param('action') eq 'column_save') {

                    _save_columns($datauserdir, $vars);
                }
                elsif (Bugzilla->cgi->param('action') eq 'column_add') {

                    _add_column($datauserdir, $vars);
                }
                elsif (Bugzilla->cgi->param('action') eq 'column_del') {

                    _delete_column($datauserdir, $vars);
                }

                elsif (Bugzilla->cgi->param('action') eq 'new') {

                    my $widget_id = int($cgi->param('widget_id'));

                    _new_widget($widget_id, $datauserdir, $vars);
                }
                elsif (Bugzilla->cgi->param('action') eq 'load') {

                    my $widget_id = int($cgi->param('widget_id'));

                    _load_widget($widget_id, $datauserdir, $vars);
                }
                elsif (Bugzilla->cgi->param('action') eq 'delete') {

                    my $widget_id = int($cgi->param('widget_id'));

                    _delete_widget($widget_id, $datauserdir, $vars);
                }
                elsif (Bugzilla->cgi->param('action') eq 'save') {

                    my $widget_id = int($cgi->param('widget_id'));

                    _save_widget($widget_id, $datauserdir, $vars);
                }
                elsif (Bugzilla->cgi->param('action') eq 'delete_overlay') {

                    my $overlay_user_id = int($cgi->param("overlay_user_id"));
                    my $overlay_id      = int($cgi->param("overlay_id"));

                    if ((($overlay_user_id == 0 && Bugzilla->user->in_group('admin')) || $overlay_user_id == $user_id)
                        && -d $dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id) {

                        my $overlay_dir = $dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id;
                        trick_taint($overlay_dir);
                        File::Path->remove_tree($overlay_dir);
                        $vars->{"overlay_ajax"} = '<h2>Overlay deleted!</h2>';
                    }
                    else {
                        $vars->{"overlay_error"} = "Illegal user or overlay id!";
                    }

                }
                elsif (Bugzilla->cgi->param('action') eq 'load_overlay') {

                    my $overlay_user_id = int($cgi->param("overlay_user_id"));
                    my $overlay_id      = int($cgi->param("overlay_id"));

                    if (
                        (
                         ($overlay_user_id == 0 || $overlay_user_id == $user_id)
                         && -e $dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id . "/overlay"
                        )
                        || (   $overlay_user_id == 0
                            && Bugzilla->user->in_group('admin')
                            && -e $dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id . "/overlay.pending")
                      ) {

                        my @files = glob $datauserdir . "/*";

                        foreach my $dir_entry (@files) {
                            trick_taint($dir_entry);
                            if (-f $dir_entry) {
                                unlink $dir_entry;
                            }
                        }

                        @files = glob $dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id . "/*";

                        foreach my $dir_entry (@files) {
                            if (-f $dir_entry) {
                                trick_taint($dir_entry);
                                my $filename = basename($dir_entry);
                                if ($filename eq "overlay.pending") {
                                    $filename = "overlay";
                                }
                                copy($dir_entry, "$datauserdir/$filename")
                                  or die "Copy failed: $!";
                            }
                        }

                        $vars->{"overlay_ajax"} = "<h2>Overlay loaded!</h2>";
                    }
                    else {
                        $vars->{"overlay_error"} = "Illegal user or overlay id!";
                    }

                }
                elsif (Bugzilla->cgi->param('action') eq 'publish_overlay') {
                    my $overlay_id      = int($cgi->param("overlay_id"));
                    my $overlay_user_id = int($cgi->param("overlay_user_id"));
                    if (   $overlay_user_id == 0
                        && Bugzilla->user->in_group('admin')
                        && -e $dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id . "/overlay.pending") {
                        trick_taint($dataextdir);
                        trick_taint($overlay_user_id);
                        trick_taint($overlay_id);

                        move($dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id . "/overlay.pending",
                             $dataextdir . "/" . $overlay_user_id . "/overlay/" . $overlay_id . "/overlay");
                        $vars->{"overlay_ajax"} = "<h2>Overlay published!</h2>";
                    }
                    else {
                        $vars->{"overlay_error"} =
                            $dataextdir . "/"
                          . $overlay_user_id
                          . "/overlay/"
                          . $overlay_id
                          . "/overlay.pending"
                          . ":Illegal overlay id or overlay already published!";
                    }

                }
                elsif (Bugzilla->cgi->param('action') eq 'save_overlay') {

                    my $overlay;
                    my @fields;
                    my $datatargetdir = $datauserdir;

                    # true/false fields
                    @fields = qw(shared);
                    foreach (@fields) {
                        $overlay->{$_} = $cgi->param("overlay_" . $_) eq 'true' ? 1 : 0;
                    }
                    if ($overlay->{"shared"}) {
                        $datatargetdir = $dataextdir . '/0';
                    }

                    # text fields
                    @fields = qw(name description);
                    my $scrubber = HTML::Scrubber->new;
                    $scrubber->default(0);
                    foreach (@fields) {
                        $overlay->{$_} =
                            $cgi->param("overlay_" . $_)
                          ? $scrubber->scrub($cgi->param("overlay_" . $_))
                          : " ";
                    }

                    # creator of overlay
                    $overlay->{"owner"}   = $user_id;
                    $overlay->{"created"} = time;
                    my $i = 1;

                    while (-d $datatargetdir . "/overlay/" . $i) {
                        $i++;
                    }
                    my $overlaydir = $datatargetdir . "/overlay/" . $i;

                    mkpath($overlaydir, { verbose => 0, mode => 0755, error => \my $err });

                    if (@$err) {
                        for my $diag (@$err) {
                            my ($file, $message) = each %$diag;
                            print "Problem making $file: $message\n";
                        }
                        die("Couldn't create $overlaydir");
                    }

                    my @files = glob $datauserdir . "/*";

                    foreach my $dir_entry (@files) {
                        if (-f $dir_entry) {
                            trick_taint($dir_entry);
                            if (   $dir_entry =~ m/\/\d+\.widget$/
                                && $overlay->{"shared"}) {

                                # strip usernames and passwords from widgets : todo to be changed so that widgets can define their private/public fields

                                my $widget = retrieve($dir_entry);
                                $widget->{'username'} = '';
                                $widget->{'password'} = '';
                                store $widget, $overlaydir . "/" . fileparse($dir_entry);
                            }
                            else {
                                copy($dir_entry, "$overlaydir/")
                                  or die "Copy failed: $!";
                            }
                        }
                    }

                    if ($overlay->{"shared"}
                        && !Bugzilla->user->in_group('admin')) {
                        store $overlay, $overlaydir . "/overlay.pending";
                        $vars->{"overlay_ajax"} = "<h2>Overlay saved, pending for approval!</h2>";
                    }
                    else {
                        store $overlay, $overlaydir . "/overlay";
                        $vars->{"overlay_ajax"} = "<h2>Overlay saved!</h2>";
                    }
                }
            }
            elsif ($page eq "dashboard_overlay.html") {
                if (Bugzilla->user->in_group('admin')) {
                    $vars->{"is_admin"} = 1;
                }
                else {
                    $vars->{"is_admin"} = 0;
                }

                my $overlaydir;
                my @users = ($user_id, 0);
                my $i     = 0;
                my $j     = 0;
                foreach (@users) {
                    $overlaydir = $dataextdir . '/' . $_ . '/overlay';
                    if (-d $overlaydir) {
                        my @folders = glob $overlaydir . "/*";
                        foreach my $dir_entry (@folders) {
                            if (-f $dir_entry . '/overlay') {
                                trick_taint($dir_entry);
                                my $overlay = retrieve($dir_entry . '/overlay');
                                my $folder  = basename($dir_entry);
                                $overlay->{"user_id"}    = $_;
                                $overlay->{"overlay_id"} = $folder;
                                my $key = $overlay->{"name"} . "\t" . $folder;
                                $vars->{"overlays"}->{"$i"}->{"$key"} = $overlay;
                                $i++;
                            }
                            elsif (-f $dir_entry . '/overlay.pending'
                                   && $vars->{"is_admin"}) {
                                trick_taint($dir_entry);
                                my $overlay = retrieve($dir_entry . '/overlay.pending');
                                my $folder  = basename($dir_entry);
                                $overlay->{"user_id"}    = $_;
                                $overlay->{"overlay_id"} = $folder;

                                $overlay->{"user_login"} = user_id_to_login($overlay->{"owner"});

                                my $key = $overlay->{"name"} . "\t" . $folder;
                                $vars->{"pending"}->{"$j"}->{"$key"} = $overlay;
                                $j++;
                            }
                        }
                    }
                }
                $vars->{"user_id"} = $user_id;
            }
            elsif ($page eq "dashboard_rss.html") {

                # JQuery requires proper content-type for rss
                print $cgi->header(-type => "text/xml");
                my $browser   = LWP::UserAgent->new();
                my $proxy_url = Bugzilla->params->{'proxy_url'};
                if ($proxy_url) {
                    $browser->proxy(['http'], $proxy_url);
                }
                else {
                    $browser->env_proxy();
                }
                $browser->timeout(10);
                my $response = $browser->get($cgi->param('rss_url'));
                if ($response->is_success) {
                    $vars->{"dashboard_external_rss"} = $response->content;
                }
                else {
                    $vars->{"dashboard_external_rss"} =
                      '<?xml version="1.0" encoding="UTF-8" ?><rss version="2.0"><channel><title>Couldn\'t load RSS feed</title></channel></rss>';
                }
            }
            else {

                # request was for dashboard.html so generate column->widgets structure and populate it with widget preferences

                my $column_total_width = 0;
                my $column_width       = 0;

                for (my $i = 0 ; $i <= $vars->{preferences}->{columns} ; $i++) {
                    if (!$vars->{preferences}->{ "column" . $i }) {
                        $vars->{"column"}->[$i] = int(100 / ($vars->{preferences}->{columns} + 1));
                    }
                    else {
                        $column_width = int($vars->{preferences}->{ "column" . $i });
                        $vars->{"column"}->[$i] = ($column_width > 10) ? $column_width : 10;
                    }
                    $column_total_width += $vars->{"column"}->[$i];
                    my $widget;
                    $widget->{'id'} = 0;
                    $vars->{"columns"}->[$i]->[0] = $widget;
                }
                if ($column_total_width != 100) {
                    for (my $i = 0 ; $i <= $vars->{preferences}->{columns} ; $i++) {
                        $vars->{"column"}->[$i] = int(100 / ($vars->{preferences}->{columns} + 1));
                    }
                }

                opendir(DIR, $datauserdir) or die($!);
                my (@files, $file);
                @files = grep(/\.widget$/, readdir(DIR));
                closedir(DIR);
                foreach $file (@files) {
                    my $widget = retrieve($datauserdir . "/" . $file);
                    if ($widget->{col} < 0) {
                        $vars->{"top_column"}->[ $widget->{pos} ] = $widget;
                    }
                    else {
                        $vars->{"columns"}->[ $widget->{col} ]->[ $widget->{pos} ] = $widget;
                    }
                }
            }
        }
        else {
            ThrowUserError('login_required');
        }
    }
}

sub config {
    my ($self, $args) = @_;

    my $config = $args->{config};
    $config->{Dashboard} = "Bugzilla::Extension::Dashboard::Config";
}

sub config_add_panels {
    my ($self, $args) = @_;

    my $modules = $args->{panel_modules};
    $modules->{Dashboard} = "Bugzilla::Extension::Dashboard::Config";
}

__PACKAGE__->NAME;
