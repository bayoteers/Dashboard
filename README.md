Dashboard Bugzilla Extension
============================

Dashboard is an extension to Bugzilla reporting system. Unified
Dashboard-extension allows you to create and view versatile dashboard of
reports and graphs. Dashboard is versatile mash-up of numerous sources in
reporting system.

Dashboard-extension has the purpose of gathering valuable information from
reporting system into reports and graphs.


Changes
-------

    1.0 - The Dashboard extensions storage backend has been rewriten to use
        database. Old file based storage is not compatible with this, and
        currently there is no migration tools for existing overlays. Upgrading
        will not destroy the old overlays, but they won't be available in the
        new version.


Concepts
--------

### Overlays

Dashboards are arranged into 'overlays', these are a set of columns and widgets
with an associated name and description. An overlay may be shared with others,
or stored private to an individual user.

When overlay is shared it goes first to 'pending' state and has to be approved
and published by admin before it visible to all other users.

### Widgets

Widgets represent the basic unit of information in a dashboard. Various widget
types are provided by default, for embedding a URL in an IFRAME, viewing RSS
feeds, holding plain text, or listing Bugzila bugs.

Each widget has an associated dialog that allows changing its settings.

Widgets may be drag'n'dropped between columns, or dragged to change their
height.


Installation
------------

This extension requires [BayotBase](https://github.com/bayoteers/BayotBase)
extension, so install it first.

1.  Put extension files in

        extensions/Dashboard

2.  Run checksetup.pl

3.  Restart your webserver if needed (for exmple when running under mod_perl)


License
-------

The code/extension is released under the [Mozilla Public License Version 2.0](
http://mozilla.org/MPL/2.0/).

The Initial Developer of the Original Code is "Nokia Corporation" Portions
created by the Initial Developer are Copyright (C) 2011 the Initial Developer.
All Rights Reserved.
