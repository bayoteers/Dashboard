#!/bin/bash

# Example script for cloning an overlay and modifying some widget parameters.

ARGS=--url=https://url.to/bugzilla/xmlrpc.cgi
ARGS="$ARGS --username=your.bugzilla.username@your-company.com"
ARGS="$ARGS --password=myPassword"
ARGS="$ARGS --http_username=some.other.username"
ARGS="$ARGS --quiet"

call() {
    ./dashboard_client.py $ARGS "$@"
}

# Stop on errors.
set -e

# Remove any existing widgets from the workspace.
call clear_workspace

# Load some predefined overlay.
call load_overlay id=54 user_id=0

# Change the color of widget 8 to yellow (use get_preferences for widget IDs).
call save_widget id=8 color=yellow

# Save as a new overlay.
call save_overlay shared=1 name='test123' # description='my awesome overlay'

# Create some new widget.
# call save_widget type=rss URL=http://reddit.com/.rss col=1 pos=4
