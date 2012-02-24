/**
 * The contents of this file are subject to the Mozilla Public
 * License Version 1.1 (the "License"); you may not use this file
 * except in compliance with the License. You may obtain a copy of
 * the License at http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS
 * IS" basis, WITHOUT WARRANTY OF ANY KIND, either express or
 * implied. See the License for the specific language governing
 * rights and limitations under the License.
 *
 * The Original Code is the Unified Dashboard Bugzilla Extension.
 *
 * The Initial Developer of the Original Code is "Nokia Corporation"
 * Portions created by the Initial Developer are Copyright (C) 2011 the
 * Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      David Wilson <ext-david.3.wilson@nokia.com>
 *      Jari Savolainen <ext-jari.a.savolainen@nokia.com>
 *
 * @requires jQuery($), jQuery UI & sortable/draggable UI modules
 */


/**
 * Return a self-referring URL with the given string appended as anchor text.
 */
function makeSelfUrl(obj)
{
    var url = window.location.toString().split('#')[0];
    return url + '#?' + $.param(obj, true);
}


/**
 * Return anchor parameters as an object.
 */
function getAnchorParams()
{
    var obj = {};
    var params = window.location.hash.substr(2).split('&');
    for(var i = 0; i < params.length; i++) {
        var bits = params[i].split('=');
        obj[bits[0]] = decodeURIComponent(bits[1]);
    }
    return obj;
}


/**
 * Left-pad a string with a character until it is a certain length.
 * @param s
 *      The string.
 * @param c
 *      The character, defaults to '0'.
 * @param n
 *      The length, defaults to 2.
 */
function lpad(s, c, n)
{
    s = '' + s;
    c = c || '0';
    n = n || 2;

    while(s.length < n) {
        s = c + s;
    }

    return s;
}


/**
 * Format a timestamp to string YYYY-MM-DD HH:MM:SS in local time.
 * @param ts
 *      Integer seconds since UNIX epoch.
 */
function formatTime(ts)
{
    var dt = new Date(ts * 1000);
    var dat = [1900 + dt.getYear(),
               lpad(dt.getMonth()),
               lpad(dt.getDay())].join('-');
    var tim = [lpad(dt.getHours()),
               lpad(dt.getMinutes()),
               lpad(dt.getSeconds())].join(':');
    return dat + ' ' + tim;
}


/**
 * Given 2 overlays, sort them:
 *      Workspaces first
 *      Newest first
 *      Lexicographically.
 */
function overlayCmp(a, b)
{
    if(a.workspace > b.workspace) {
        return -1;
    } else if(a.workspace < b.workspace) {
        return 1;
    } else if(a.modified > b.modified) {
        return -1;
    } else if(a.modified < b.modified) {
        return 1;
    } else if(a.name > b.name) {
        return 1;
    } else if(a.name < b.name) {
        return -1;
    }
    return 0;
}


/**
 * Clone a template.
 *
 * @param sel
 *      jQuery selector referencing template DOM element.
 * @returns
 *      Cloned DOM element with id attribute removed.
 */
function cloneTemplate(sel)
{
    var cloned = $(sel).clone();
    cloned.removeAttr('id');
    return cloned;
}


/**
 * Return integer seconds since UNIX epoch GMT.
 */
function now()
{
    return Math.floor((new Date).getTime());
}


/**
 * Base widget. To keep things simple, currently combines state and visual
 * rendering. Manages constructing a widget's DOM, cloning any templates,
 * refresh timer, and rendering the widget's settings.
 *
 * The default render() prepopulates the widget's element with a
 * "#<type>_widget_template" template, if one exists. The default
 * renderSettings() prepopulates "#<type>_widget_settings_template". Both
 * templates are expected to be defined in dashboard.html.tmpl. Subclasses are
 * expected to at least override render() and provide some behaviours for these
 * templates.
 */
var Widget = Base.extend({
    /**
     * Create an instance.
     *
     * @param dashboard
     *      Dashboard object.
     * @param state
     *      Initial widget state.
     */
    constructor: function(dashboard, state)
    {
        // Shorthand.
        this._dashboard = dashboard;
        if(! this.TYPE) {
            this.TYPE = this.constructor.TYPE;
        }
        if(! this.TEMPLATE_TYPE) {
            this.TEMPLATE_TYPE = this.TYPE;
        }

        /** Contains title bar, controls, settings box, and content. */
        this.element = null;
        /** "content" element; contains the actual widget content */
        this.contentElement = null;

        this.refreshIntervalId = null;

        this.render();
        this.renderSettings();
        this.setState(state);
        this.reload();
    },

    /**
     * Override in subclass; default implementation just appends
     * "<type>_widget_template" children to the content area.
     */
    render: function()
    {
        this.element = cloneTemplate('#widget_template');
        this.headElement = $('.widget-head', this.element);
        this.bodyElement = $('.widget-body', this.element);
        this.hintElement = $('.widget-hint', this.element);
        this.contentElement = $('.widget-content', this.element);

        this._child('.remove').click(this._onRemoveClick.bind(this));
        this._child('.refresh').click(this.reload.bind(this));
        this._child('.collapse').click(this._onMinimizeClick.bind(this));

        this._child('.edit').click(this.edit.bind(this));
        this._child('.save').click(this._onSaveClick.bind(this));
        this._child('.save').hide();

        this.element.bind('vertical_resize', this._onResize.bind(this));

        // Populate content element with widget's template, if one exists.
        var sel = '#' + this.TEMPLATE_TYPE + '_widget_template';
        this.contentElement.append(cloneTemplate(sel));
    },

    /**
     * Called when the widget's height or width changes. The default
     * implementation adjusts the content element height to match.
     *
     * Subclasses should use this.contentElement.height() to determine the
     * maximum height their elements can grow to.
     */
    _onResize: function() {
        var px;
        if(this.state.maximized) {
            px = $(window).height() - this.hintElement.outerHeight();
        } else {
            px = this.state.height - this.headElement.outerHeight();
        }
        this.contentElement.height(px);
    },

    /**
     * Extend in subclass; default implementation just appends the default
     * name, title, color, and refresh interval options.
     */
    renderSettings: function()
    {
        var list = this._child('.edit-box .colors');
        for(var i = 0; i < Widget.COLORS.length; i++) {
            var color = Widget.COLORS[i];
            var item = $('<li>');
            item.addClass('color-' + color);
            item.click(this.update.bind(this, { color: color }));
            item.appendTo(list);
        }

        var sel = '#' + this.TEMPLATE_TYPE + '_widget_settings_template';
        var template = cloneTemplate(sel);
        template.children().appendTo(this._child('.edit-box'));
    },

    _onTitleKeyup: function()
    {
        var value = this._child('.field-title').val();
        this._child('.widget-title').text(value);
    },

    /**
     * Update the state from the settings dialog fields. Called during save,
     * override in subclass to include your fields.
     */
    _apply: function()
    {
        this.update({
            title: this._child('.field-title').val(),
            refresh: +this._child('.field-refresh').val()
        });
    },

    /**
     * Update the state of the settings dialog; Called on display of settings,
     * override in subclass to include your fields.
     */
    _restore: function()
    {
        for(var key in this.state) {
            if(! this.state.hasOwnProperty(key)) {
                continue;
            }

            var value = this.state[key];
            this._child('.field-' + key).val(value);
        }
    },

    /**
     * Request the editing controls be shown.
     */
    edit: function(event)
    {
        this._restore();
        this._child('.edit').hide();
        this._child('.save').show();
        this._child('.edit-box').show();
    },

    _onSaveClick: function()
    {
        this._apply();
        this.reload();
        this._dashboard.save();
        this._child('.edit').show();
        this._child('.save').hide();
        this._child('.edit-box').hide();
    },

    /**
     * Update just a few widget parameters.
     */
    update: function(state)
    {
        this.setState($.extend({}, this.state, state));
    },

    /**
     * Replace all widget parameters with a new state.
     */
    setState: function(state)
    {
        // Fill any missing parameters using the defaults.
        state = $.extend({}, Widget.DEFAULT_STATE, state);
        this.state = state;

        // toggle() insists on bool.
        this.contentElement.toggle(!state.minimized);

        this._setColor(state.color);
        this._setRefreshSecs(state.refresh);

        state.height = Math.max(Widget.MIN_HEIGHT, state.height);
        this._onResize();

        // Temporarily needed for drag'n'drop code below.
        this.element.data('widgetId', state.id);

        this._child('.widget-title').text(state.title);
        this._child('.widget-title').keyup(this._onTitleKeyup.bind(this));
    },

    /**
     * Color the widget frame as appropriate.
     */
    _setColor: function(color)
    {
        var oldColor = this.element.data('color');
        if(oldColor) {
            this.element.removeClass('color-' + oldColor);
        }

        if(color) {
            this.element.addClass('color-' + color);
        }

        this.element.data('color', color);
    },

    /**
     * Arrange for reload() to be called periodically.
     *
     * @param secs
     *      Seconds between reload() calls. If 0, cancels any existing timer.
     */
    _setRefreshSecs: function(secs)
    {
        clearTimeout(this.refreshIntervalId);
        if(secs) {
            var callback = this.reload.bind(this);
            var ms = secs * 1000;
            this.refreshIntervalId = setInterval(callback, ms);
        }
    },

    /**
     * Return any matching child elements.
     */
    _child: function(sel)
    {
        return $(sel, this.element);
    },

    _onMinimizeClick: function()
    {
        this.update({
            minimized: !this.state.minimized
        });
        this._dashboard.save();
    },

    _onRemoveClick: function()
    {
        if(confirm('This widget will be removed, ok?')) {
            this._dashboard.deleteWidget(this);
        }
        return false;
    },

    destroy: function()
    {
        this.element.remove();
        clearTimeout(this.refreshIntervalId);
    },

    reload: function()
    {
        // Override in subclass.
    }
}, /* class variables: */ {

    /** Mapping of type name of constructor. */
    _classes: {},

    /** Minimum height for any widget. */
    MIN_HEIGHT: 100,

    /** Values assigned if they're missing during createInstance(). */
    DEFAULT_STATE: {
        color: 'gray',
        minimized: false,
        height: 0
    },

    /** Color classes we have CSS defined for. */
    COLORS: ['gray', 'yellow', 'red', 'blue', 'white', 'orange', 'green'],

    /**
     * Register a Widget subclass for use with Widget.createInstance().
     *
     * @param type
     *      String type name, e.g. "rss".
     * @param klass
     *      Constructor, i.e. the result of Widget.extend().
     */
    addClass: function(type, klass) {
        klass.TYPE = type;
        this._classes[type] = klass;
    },

    /**
     * Create a Widget given a state object.
     *
     * @param dashboard
     *      Dashboard the widget is associated with.
     * @param state
     *      Widget state object, including at least "type", which is the type
     *      of the widget to create.
     */
    createInstance: function(dashboard, state) {
        var klass = this._classes[state.type];
        return new klass(dashboard, state);
    }
});


/**
 * URL widget implementation.
 */
Widget.addClass('url', Widget.extend({
    // See Widget.render().
    render: function()
    {
        this.base();
        this._iframe = this._child('iframe')
        this._iframe.load(this._onIframeLoad.bind(this));
    },

    /**
     * Handle completion of IFRAME load by attempting to modify (and replace)
     * the child document using the elements matched by the configured CSS
     * selector, if any. This may fail due to browser same-origin policy (e.g.
     * different domain).
     */
    _onIframeLoad: function()
    {
        if(this.state.maximized || !this.state.selector) {
            return;
        }

        try {
            // Any property access will throw if same origin policy in effect.
            var location = this._iframe[0].contentDocument.location;
        } catch(e) {
            if(window.console) {
                console.error('_onIframeLoad: can\'t apply CSS: %o', e);
            }
            return;
        }

        var body = $('body', this._iframe[0].contentDocument);
        var matched = $(this.state.selector, body);
        body.children().remove();
        matched.appendTo(body);
        matched.css('padding', '0px');
        body.css('margin', '0px');
        $('html', this._iframe).css('margin', '0px');
    },

    // See Widget.renderSettings().
    renderSettings: function()
    {
        this.base();
        this._child('.field-load-url').click(this._onLoadUrlClick.bind(this));
    },

    // See Widget._restore().
    _restore: function()
    {
        this.base();
        this._child('.field-URL').val(this.state.URL);
        this._child('.field-selector').val(this.state.selector);
    },

    // See Widget._apply().
    _apply: function()
    {
        this.base()
        this.update({
            URL: this._child('.field-URL').val(),
            selector: this._child('.field-selector').val()
        });
    },

    _onLoadUrlClick: function()
    {
        this.update({
            URL: this._child('.field-URL').val()
        });
        this.reload();
    },

    // See Widget._onResize().
    _onResize: function()
    {
        this.base();
        this._iframe.height(this.contentElement.height());
    },

    // See Widget.setState().
    setState: function(state)
    {
        this.base(state);

        if(this._iframe.attr('src') != this.state.URL) {
            this._iframe.attr('src', this.state.URL);
        }
    },

    // See Widget.reload().
    reload: function()
    {
        this._iframe.attr('src', this.state.URL);
    }
}));


/**
 * RSS widget implementation.
 */
Widget.addClass('rss', Widget.extend({
    // See Widget.renderSettings().
    renderSettings: function()
    {
        this.base();
        this._child('.field-load-url').click(this._onLoadUrlClick.bind(this));
    },

    _onLoadUrlClick: function()
    {
        this._widget.setState({
            URL: this._child('.field-URL').val()
        });
        this.reload();
    },

    // See Widget._restore().
    _restore: function()
    {
        this.base();
        this._child('.field-URL').val(this.state.URL);
        this._child('.field-username').val(this.state.username);
        this._child('.field-password').val(this.state.password);
    },

    // See Widget._apply().
    _apply: function()
    {
        this.base();
        this.update({
            URL: this._child('.field-URL').val(),
            username: this._child('.field-username').val(),
            password: this._child('.field-password').val()
        });
    },

    // See Widget.reload().
    reload: function()
    {
        if(! this.state.URL) {
            this.contentElement.text('Please set a feed URL.');
            return;
        }

        this.contentElement.html(cloneTemplate('#loader_template'));
        var rpc = new Rpc('Dashboard', 'get_feed', { url: this.state.URL });
        rpc.fail(this._onReloadFail.bind(this));
        rpc.done(this._onReloadDone.bind(this));
        this._onResize();
    },

    /**
     * Display an error message when the feed cannot be fetched.
     *
     * @param error
     *      String error from backend.
     */
    _onReloadFail: function(error)
    {
        var clone = cloneTemplate('#rss_widget_error');
        $('.error-text', clone).text(error);
        this.contentElement.html(clone);
    },

    /**
     * Populate our template with the feed contents.
     *
     * @param feed
     *      Feed JSON object, as returned by get_feed RPC.
     */
    _onReloadDone: function(feed)
    {
        var template = cloneTemplate('#rss_widget_template');

        if(feed.link) {
            $('h2 a', template).attr('href', feed.link);
            $('h2 a', template).text(feed.title);
        } else {
            $('h2', template).text(feed.title);
        }

        var length = Math.min(feed.items.length,
            DASHBOARD_CONFIG.rss_max_items);
        for(var i = 0; i < length; i++) {
            template.append(this._formatItem(feed.items[i]));
        }

        this.contentElement.html(template);
        this.contentElement.trigger('vertical_resize');
    },

    /**
     * Format a single item.
     *
     * @param item
     *      Item JSON object as returned by get_feed RPC.
     */
    _formatItem: function(item)
    {
        var template = cloneTemplate('#rss_item_template');
        $('h3 a', template).text(item.title);
        $('h3 a', template).attr('href', item.link);
        $('.updated-text', template).text(item.modified);
        $('.description-text', template).text(this._sanitize(item.description));
        return template;
    },

    _sanitize: function(html)
    {
        // TODO
        html = html || '';
        var s = html.replace(/^<.+>/, '');
        return s.replace(/<.+/g, '');
    },

    _onResize: function()
    {
        this.base();
        this._child('.rss').height(this.contentElement.height());
    }
}));


/**
 * Text widget implementation.
 */
Widget.addClass('text', Widget.extend({
    // See Widget._restore().
    _restore: function()
    {
        this.base();
        this._child('.field-text').val(this.state.text || '');
    },

    // See Widget._apply().
    _apply: function()
    {
        this.base();
        this.update({
            text: this._child('.field-text').val()
        });
    },

    // See Widget.reload().
    reload: function()
    {
        var elem = this.contentElement;
        elem.css('padding', '8px');
        elem.text(this.state.text || '');
        // Convert line breaks to <br>.
        elem.html(elem.html().replace(/\n/g, '<br>\n'));
    }
}));


/**
 * Dashboard 'model': this maintains the front end's notion of the workspace
 * state, which includes column widths, widget instances, user's login state,
 * and available overlay list.
 *
 * 'View' classes are expected to subscribe to the various *Cb callbacks, and
 * update their visual presentation based on, and *only* based on, the state
 * reflected by this model when the callback fires. This means visual changes
 * associated with a mutation (e.g. resizing a column) should not apply until
 * after the callback.
 *
 * Methods are provided for saving state; they return Rpc objects. If some
 * visual update is required following a mutation (e.g. closing a dialog after
 * a saving an overlay), this should be done by subscribing to the ".done()"
 * event provided by the Rpc.
 */
var Dashboard = Base.extend({
    /**
     * Create an instance. 
     *
     * @param config
     *      Dashboard configuration object passed in via JSON object in
     *      dashboard.html.
     */
    constructor: function(config)
    {
        this.stateChangeCb = new jQuery.Callbacks();
        this.columnsChangeCb = new jQuery.Callbacks();
        this.widgetAddedCb = new jQuery.Callbacks();
        this.widgetRemovedCb = new jQuery.Callbacks();
        this.notifyCb = new jQuery.Callbacks();
        this.overlaysChangeCb = new jQuery.Callbacks();

        // Widgets in the user's workspace.
        this.widgets = [];
        // Columns in the user's workspace.
        this.columns = [];
        // Integer overlay ID to save workspace changes to.
        this.overlayId = config.overlay_id;
        // Integer user ID.
        this.userId = config.user_id;
        // String user's login name.
        this.login = config.user_login;
        // Bool is user an admin.
        this.isAdmin = config.is_admin;

        // Description of loaded overlay. Note the 'widgets' and 'columns'
        // properties are only used during initial load; the 'widgets' and
        // 'columns' properties of the Dashboard object itself describe the
        // actual state of columns and widgets.
        this.overlay = null;
    },

    /**
     * Repopulate with the initial blank workspace (separate from constructor
     * since view classes need to subscribe before this fires any events),
     * containing some informative welcome text.
     */
    reset: function()
    {
        this.setOverlay($.extend(this._makeDefaultOverlay(),
        {
            columns: [
                { width: 25 },
                { width: 50 },
                { width: 25 }
            ],
            widgets: [{
                id: 1,
                col: 1,
                pos: 1,
                type: 'text',
                title: 'Welcome to Dashboard',
                height: 150,
                text: $('#dashboard_welcome_text').text()
            }]
        }));
    },

    /**
     * Create an empty overlay for our workspace.
     */
    _makeDefaultOverlay: function()
    {
        return {
            name: 'Workspace',
            description: 'Unsaved changes',
            owner: this.login,
            user_id: this.userId,
            id: this.overlayId,
            workspace: true,
            columns: this._makeColumns(3),
            widgets: []
        };
    },

    /**
     * Fetch a widget given its ID. Used for drag'n'drop.
     */
    widgetById: function(id)
    {
        id = +id;
        for(var i = 0; i < this.widgets.length; i++) {
            var widget = this.widgets[i];
            if(widget.state.id == id) {
                return widget;
            }
        }
    },

    /**
     * Reset front-end state to match the overlay described by the given
     * JSON object.
     *
     * @param workspace
     *      Overlay JSON, as represented by get_overlay, get_preferences RPCs.
     */
    setOverlay: function(overlay)
    {
        this.overlay = overlay;
        while(this.widgets.length) {
            var widget = this.widgets.pop();
            this.widgetRemovedCb.fire(widget);
        }

        this.columns = overlay.columns;
        this.columnsChangeCb.fire(this.columns);

        for(var i = 0; i < overlay.widgets.length; i++) {
            var widget = Widget.createInstance(this, overlay.widgets[i]);
            this.widgets.push(widget);
            this.widgetAddedCb.fire(widget);
        }
    },

    /**
     * Ask the server to delete an overlay.
     */
    deleteOverlay: function(overlay)
    {
        var rpc = this.rpc('delete_overlay', {
            user_id: overlay.user_id,
            id: overlay.id
        });
        rpc.done(this._onDeleteOverlayDone.bind(this, overlay));
    },

    _onDeleteOverlayDone: function(overlay, overlays)
    {
        this.setOverlays(overlays);
        this.notifyCb.fire('Deleted overlay: ' + overlay.name);
    },

    /**
     * Reset our notion of what overlays are available.
     *
     * @param overlays
     *      Array of overlay objects, as returned by get_overlays RPC.
     */
    setOverlays: function(overlays)
    {
        // Remove this tab's workspace from the returned list.
        var that = this;

        this.overlays = $.grep(overlays, function(o)
        {
            return o.user_id != that.userId || o.id != that.overlayId;
        });
        this.overlays.sort(overlayCmp);
        this.overlaysChangeCb.fire(this.overlays);
    },

    /**
     * Reset our notion of what columns are available.
     *
     * @param columns
     *      Array of columns objects, as returned by get_columns RPC.
     */
    setColumns: function(columns)
    {
        this.columns = columns;
        this.columnsChangeCb.fire(columns);
    },

    /**
     * Start an RPC to the Dashboard web service.
     *
     * @param method
     *      Method name.
     * @param params
     *      Object containing key/value pairs to send to method.
     * @returns
     *      RPC object.
     */
    rpc: function(method, params, cb)
    {
        var rpc = new Rpc('Dashboard', method, params);
        rpc.fail(function(e) { alert(e.message ? e.message : e); });
        rpc.fail(this.notifyCb.fire.bind(this.notifyCb));
        return rpc;
    },

    /**
     * Return an array of equally sized column objects.
     *
     * @param count
     *      Number of columns.
     */
    _makeColumns: function(count)
    {
        var cols = [];
        for(var i = 0; i < count; i++) {
            cols.push({
                width: Math.floor(100 / count)
            });
        }
        return cols;
    },

    /**
     * Clear the user's workspace, deleting the temporary workspace overlay on
     * the server simultaneously.
     */
    clear: function()
    {
        this.setOverlay(this._makeDefaultOverlay());
        this.deleteOverlay({
            id: this.overlayId,
            user_id: this.userId,
            name: 'Unsaved changes'
        });
    },

    /**
     * Ask the server to add a column to the workspace.
     */
    addColumn: function()
    {
        if(this.columns.length == 4) {
            return alert("Can't add new column, maximum reached.");
        }
        this.setColumns(this._makeColumns(this.columns.length + 1));
        this.notifyCb.fire('Added a new column.');
        this.save();
    },

    /**
     * Reset column widths to be even.
     */
    resetColumns: function()
    {
        this.setColumns(this._makeColumns(this.columns.length));
        this.notifyCb.fire('Column widths reset.');
        this.save();
    },

    /**
     * Find the first unused widget ID by examining our list of widgets.
     */
    _getFreeWidgetId: function()
    {
        var id = 1;
        for(var i = 0; i < this.widgets.length; i++) {
            id = Math.max(id, this.widgets[i].state.id + 1);
        }
        return id;
    },

    /**
     * Ask the server to add a widget to the workspace.
     *
     * @param type
     *      One of the supported widget types.
     */
    addWidget: function(type)
    {
        var widget = Widget.createInstance(this, {
            id: this._getFreeWidgetId(),
            title: 'Unnamed widget',
            type: type,
            col: 0, // wtf?
            pos: 99, // wtf?
        });

        this.widgets.push(widget);
        this.notifyCb.fire('Created ' + widget.state.type + ' widget.');
        this.widgetAddedCb.fire(widget);
        this.save();
        widget.edit();
    },

    /**
     * Ask the server to delete a widget.
     *
     * @param widget
     *      Widget object.
     */
    deleteWidget: function(widget)
    {
        this.widgets = $.grep(this.widgets, function(widget_)
        {
            return widget_ !== widget;
        });

        this.widgetRemovedCb.fire(widget);
        this.notifyCb.fire('Deleted widget: ' + widget.state.title);
        this.save();
    },

    /**
     * Refresh our notion of available overlays.
     */
    getOverlays: function()
    {
        var rpc = this.rpc('get_overlays');
        rpc.done(this._onGetOverlaysDone.bind(this));
        return rpc;
    },

    _onGetOverlaysDone: function(overlays)
    {
        this.setOverlays(overlays);
        this.notifyCb.fire('Refreshed overlay list.');
    },

    /**
     * Ask the server to replace our workspace with the given overlay.
     *
     * @param overlay
     *      One of the overlay objects from the overlay list.
     */
    loadOverlay: function(overlay)
    {
        var rpc = this.rpc('clone_overlay', {
            user_id: overlay.user_id,
            id: overlay.id,
            new_id: this.overlay.id
        });

        rpc.done(this._onLoadOverlayDone.bind(this));
        return rpc;
    },

    _onLoadOverlayDone: function(overlay)
    {
        this.setOverlay(overlay);
        this.notifyCb.fire('Overlay ' + overlay.name + ' loaded.');
    },

    /**
     * Ask the server to save out workspace as a new overlay.
     *
     * @param overlay
     *      Object with the properties as defined in
     *      WebService.pm::OVERLAY_FIELD_DEFS.
     */
    saveOverlay: function(overlay)
    {
        overlay = $.extend(this._makeOverlay(), overlay, {
            workspace: 0,
            id: 0
        });

        var rpc = this.rpc('set_overlay', overlay);
        rpc.done(this._onSaveOverlayDone.bind(this, overlay));
        return rpc;
    },

    _onSaveOverlayDone: function(overlay, response)
    {
        this.notifyCb.fire('Saved overlay: ' + overlay.name);
    },

    /**
     * Ask the server to publish a user's overlay that is pending to be shared.
     *
     * @param overlay
     *      One of the overlay objects from the overlay list.
     */
    publishOverlay: function(overlay)
    {
        var rpc = this.rpc('publish_overlay', overlay);
        rpc.done(this._onPublishOverlayDone.bind(this, overlay));
        return rpc;
    },

    _onPublishOverlayDone: function(overlay, response)
    {
        this.notifyCb.fire('Published overlay: ' + overlay.name);
        this.overlaysChangeCb.fire(response);
    },

    /**
     * Ask the server to delete a trailing column and its widgets.
     */
    deleteColumn: function()
    {
        var deleteId = this.columns.length - 1;
        if(deleteId == 0) {
            return alert('Cannot delete the last column.');
        }

        var that = this;
        $.each(this.widgets, function(_, widget)
        {
            if(widget.state.col == deleteId) {
                that.deleteWidget(widget);
            }
        });

        this.setColumns(this._makeColumns(this.columns.length - 1));
        this.notifyCb.fire('Column removed.');
        this.save();
    },

    /**
     * Ask the server to record some column widths.
     *
     * @param columns
     *      Column objects in the format of this.columns.
     */
    saveColumns: function(columns)
    {
        this.setColumns(columns);
        this.save();
    },

    /**
     * Return an array describing state of widgets in the workspace, as
     * understood by 'save_workspace' RPC.
     *
     * @returns
     *      Array of objects containing widget parameters.
     */
    _getWidgetStates: function()
    {
        return $.map(this.widgets, function(widget)
        {
            return widget.state;
        });
    },

    /**
     * Return an overlay structure describing the current workspace state, and
     * taking the remaining metadata fields from this.overlay.
     */
    _makeOverlay: function()
    {
        return $.extend({}, this.overlay, {
            columns: this.columns,
            widgets: this._getWidgetStates()
        });
    },

    /**
     * Save the current workspace state. If a save is already in progress, just
     * set a flag telling the completion handler to start another one. This
     * avoids races in two places:
     *      1. Lack of locking in Bugzilla extension code.
     *      2. An earlier request completes before a later request, which hangs
     *         indefinitely, resulting in stale state being saved.
     */
    save: function()
    {
        this._saveAgain = true;
        if(this._lastSaveRpc) {
            return;
        }

        this._saveAgain = false;
        this._lastSaveRpc = this.rpc('set_overlay', this._makeOverlay());
        this._lastSaveRpc.done(this._onSaveDone.bind(this));
        this._lastSaveRpc.complete(this._onSaveComplete.bind(this));
        return this._lastSaveRpc;
    },

    /**
     * Handle save completion by clearing _lastSaveRpc. Note this must be done
     * for success *and* failure.
     */
    _onSaveComplete: function()
    {
        this._lastSaveRpc = null;
    },

    /**
     * Handle successful save by checking to see if there were any more
     * attempts to save while the last RPC was in progress. If so, save again.
     */
    _onSaveDone: function(overlay)
    {
        this._lastSaveRpc = null;

        if(this._saveAgain) {
            this.save();
        } else {
            // In case of updates to overlay metadata, only overwrite the
            // frontend's metadata if another save isn't pending (e.g. user
            // updated overlay name immediately after deleting a widget, and
            // widget deletion RPC hasn't completed yet).
            this.overlay = overlay;
        }
    }
});


/**
 * Manage a set of resizable columns within which resizable widgets are
 * displayed. Responds to events fired by the associated Dashboard instance to
 * update the view.
 */
var WidgetView = Base.extend({
    constructor: function(dashboard)
    {
        this._dashboard = dashboard;
        dashboard.widgetAddedCb.add(this._onWidgetAdded.bind(this));
        dashboard.widgetRemovedCb.add(this._onWidgetRemoved.bind(this));
        dashboard.columnsChangeCb.add(this._onColumnsChange.bind(this));

        this._maximizedWidget = null;
        this._element = $('#columns');
        this._columns = [];
        this._columns[-1] = $('#column-1'); // No effect on Array.length.

        $(document).keyup(this._onDocumentKeyup.bind(this));
        $(window).on('resize', this._onWindowResize.bind(this));
    },

    /**
     * Add or remove columns until the rendered count matches the desired
     * count.
     */
    _onColumnsChange: function(columns)
    {
        while(this._columns.length > this._dashboard.columns.length) {
            this._columns.pop().remove();
        }

        while(this._columns.length < this._dashboard.columns.length) {
            var column = cloneTemplate('#column_template');
            // Necessary for drag'n'drop code below.
            column.data('column_id', this._columns.length);
            this._columns.push(column);
            this._element.append(column);
        }

        this._makeSortable();
        this._updateColumnWidths();
    },

    /**
     * Search the list of widgets for the widget preceeding the given one.
     * Insert it in the DOM after that point, otherwise if no such widget is
     * found, append it to the widget's column instead.
     *
     * @param widget
     *      Widget to insert.
     */
    _insertWidget: function(widget)
    {
        var preceeding = null;
        for(var i = 0; i < this._dashboard.widgets.length; i++) {
            var other = this._dashboard.widgets[i];
            if(other.state.id != widget.state.id
               && other.state.col == widget.state.col
               && other.state.pos < widget.state.pos) {
                preceeding = other;
            }
        }

        if(preceeding) {
            preceeding.element.after(widget.element);
        } else {
            this._columns[widget.state.col].append(widget.element);
        }
    },

    /**
     * Respond to widget addition by inserting its element at the correct
     * location.
     */
    _onWidgetAdded: function(widget)
    {
        if(widget.state.col > this._columns.length) {
            widget.state.col = 1;
        }

        widget._child('.maximize').click(
            this._onMaximizeClick.bind(this, widget));
        this._insertWidget(widget);
        widget.element.trigger('vertical_resize');
        this._makeSortable();
        this._updateColumnWidths();
    },

    /**
     * Respond to widget removal by animating the widget's destruction then
     * removing it from the DOM.
     */
    _onWidgetRemoved: function(widget)
    {
        var elem = widget.element;
        elem.animate({ opacity: 0 }, function()
        {
            elem.slideUp(function()
            {
                elem.remove();
                widget.destroy();
            });
        });
    },

    /**
     * Respond to click on the widget's maximize button by displaying the
     * restore hint, and applying CSS to display the widget contents full
     * screen.
     */
    _onMaximizeClick: function(widget) {
        widget.hintElement.click(this.restore.bind(this));
        widget.hintElement.show();
        widget.bodyElement.addClass('widget-max');
        widget.update({
            maximized: true
        });
        this._maximizedWidget = widget;
        this._updateWidgetResizable(widget);
        widget.element.trigger('vertical_resize');
    },

    /**
     * Respond to window resize by triggering the vertical_resize event on the
     * maximized widget, if any. If there is no maximized widget, then this
     * means the columns are visisble, so recalculate their widths.
     *
     * TODO: this should be implemented in CSS, as installing window.onresize
     * handlers results in extremely slow painting in every browser.
     */
    _onWindowResize: function()
    {
        if(this._maximizedWidget) {
            this._maximizedWidget.element.trigger('vertical_resize');
        } else {
            this._updateColumnWidths();
        }
    },

    /**
     * Respond to escape key being pressed by restoring the maximized widget.
     */
    _onDocumentKeyup: function(e)
    {
        // Clear maximized widgets when ESC is pressed.
        if(e.keyCode == 27) {
            this.restore();
        }
    },

    /**
     * Restore the maximized widget, if any.
     */
    restore: function()
    {
        var widget = this._maximizedWidget;
        if(! widget) {
            return;
        }

        this._maximizedWidget = null;

        widget.hintElement.hide();
        widget.bodyElement.removeClass('widget-max');

        widget.update({
            maximized: false
        });

        this._updateWidgetResizable(widget);
        this._updateColumnWidths();
    },

    /**
     * Update a widget's jQuery resizable() state, destroying it if the widget
     * is marked as maximized, otherwise (re)creating it.
     */
    _updateWidgetResizable: function(widget)
    {
        if(widget.state.maximized) {
            if(widget.bodyElement.data('resizable')) {
                widget.bodyElement.resizable('destroy');
            }
        } else {
            widget.bodyElement.resizable({
                handles: 'e, s, se',
                minHeight: Widget.MIN_HEIGHT,
                minWidth: 75,
                maxWidth: this._getMaxWidth(widget.state.col),
                helper: 'widget-state-highlight',
                start: this._disableIframes,
                stop: this._onWidgetResizeStop.bind(this, widget)
            });
        }
    },

    /**
     * Set a column's width to a new value, adjusting other columns to
     * compensate for the size change.
     *
     * @param idx
     *      Column index (0..Dashborad.columns.length).
     * @param newPct
     *      Integer width in percent.
     */
    _setColumnWidth: function(idx, newPct)
    {
        if(idx == -1) {
            return;
        }

        // Make a new column information structure and save it on the server.
        // saveColumns() will fire columnsChangeCb on success, which will cause
        // the actual resize to occur.
        var deltaPct = this._dashboard.columns[idx].width - newPct;
        var cols = $.extend(true, [], this._dashboard.columns);
        cols[idx].width -= deltaPct;
        cols[cols.length - 1].width += deltaPct;
        this._dashboard.saveColumns(cols);
    },

    /**
     * On Firefox/Windows, cross-domain iframes will swallow mousemove events,
     * making sortable() feel horrible. So hide the IFRAMEs while dragging.
     */
    _disableIframes: function()
    {
        $('iframe').css('visibility', 'hidden');
    },

    /**
     * Undo _onWidgetResizeStart() IFRAME hide.
     */
    _enableIframes: function()
    {
        $('iframe').css('visibility', '');
    },

    /**
     * Handle a widget's content area being resized by updating the width of
     * the widget's column and storing the height of the widget itself.
     *
     * @param widget
     *      Widget object passed from _updateWidgetResizable().
     */
    _onWidgetResizeStop: function(widget)
    {
        this._enableIframes();

        var content = widget.contentElement;
        var newPct = Math.floor(100 * (content.width() / (55 + this._element.width())));
        content.css('width', '');

        var height = content.height() + widget.headElement.outerHeight();
        content.css('height', '');
        widget.update({ height: height });
        this._setColumnWidth(widget.state.col, newPct);
        this._dashboard.save();
    },

    /**
     * Handle a column's element being resized by updating the stored width.
     *
     * @param idx
     *      Column index, passed from _updateColumnWidths().
     */
    _onColumnResizeStop: function(idx)
    {
        this._enableIframes();

        var helper = $('.column_helper', this._columns[idx]);
        var newPct = Math.floor(100 * (helper.width() / this._element.width()));
        helper.css('width', '100%');
        this._setColumnWidth(idx, newPct);
    },

    MIN_WIDTH: 100,

    /**
     * Compute the maximum any column but the last may grow by. This is the
     * difference between the last column's current size and its minimum size.
     */
    _getMaxWidth: function(idx)
    {
        if(idx == -1) {
            return this._element.width();
        }

        var last = this._columns[this._columns.length - 1];
        var maxGrowth = Math.max(0, last.width() - this.MIN_WIDTH);
        var pct = (this._element.width() - 4) / 100;
        return (this._dashboard.columns[idx].width * pct) + maxGrowth;
    },

    /**
     * After a resize (and manually at various other times), reset the column
     * widths proportional to the new container size.
     */
    _updateColumnWidths: function()
    {
        this._dashboard.widgets.forEach(this._updateWidgetResizable, this);

        for(var i = 0; i < this._columns.length; i++) {
            var notLast = (i + 1) != this._columns.length;

            var column = this._columns[i];
            var helper = $('.column_helper', column);

            $('.arrow_left', helper).toggle(i != 0);
            $('.arrow_right', helper).toggle(notLast);

            var info = this._dashboard.columns[i];
            column.width(info.width + '%');

            if(notLast) {
                helper.resizable({
                    handles: 'e',
                    minWidth: this.MIN_WIDTH,
                    maxWidth: this._getMaxWidth(i),
                    helper: 'column-state-highlight',
                    start: this._disableIframes,
                    stop: this._onColumnResizeStop.bind(this, i)
                });
            }
        }
    },

    /**
     * Return a jQuery object containing widget elements that should be
     * resizable.
     */
    _getSortableWidgetElements: function()
    {
        var sortable = $();
        for(var i = 0; i < this._dashboard.widgets.length; i++) {
            var widget = this._dashboard.widgets[i];
            sortable.push(widget.element);
        }
        return sortable;
    },

    /**
     * Configure jQuery UI sortable() on all the column elements. Called when
     * the set of widgets or columns changes.
     */
    _makeSortable: function()
    {
        var sortable = this._getSortableWidgetElements();
        var heads = $('.widget-head', sortable);

        $('.column').sortable({
            connectWith: $('.column'),
            containment: 'document',
            delay: 100,
            forcePlaceholderSize: true,
            handle: '.widget-head',
            items: sortable,
            opacity: 0.8,
            placeholder: 'widget-placeholder',
            revert: 300,
            start: this._onSortStart.bind(this),
            stop: this._onSortStop.bind(this),
            tolerance: 'pointer'
        });
    },

    /**
     * When a 'sort' (aka. widget move) starts, set the moved widget's width to
     * a rough approximation of the column size; to improve usability for
     * widgets being moved from the top column.
     */
    _onSortStart: function(e, ui) {
        this._disableIframes();
        var width = this._element.width() / this._columns.length;
        ui.item.css('width', Math.min(300, width));
    },

    /**
     * When a widget mode ends, reset the moved widget's width to inherit from
     * the CSS rules, and update its state to reflect the column it was dragged
     * to.
     */
    _onSortStop: function(e, ui) {
        this._enableIframes();
        ui.item.css('width', '');
        var columnId = ui.item.parent('.column').data('column_id');
        var widgetId = ui.item.data('widgetId');
        var widget = this._dashboard.widgetById(widgetId);
        widget.update({
            col: columnId
        });
        $(window).trigger("resize");
        this._makeSortable();
        this._dashboard.save();
    }
});


/**
 * Renders the list of overlays available to load.
 */
var OverlayView = Base.extend({
    constructor: function(dashboard)
    {
        this._dashboard = dashboard;
        dashboard.overlaysChangeCb.add(this._onOverlaysChange.bind(this));
        this._setupUi();
    },

    _setupUi: function()
    {
        this._element = $('#overlay_page');

        var saveButton = $('#overlay_save_button');
        saveButton.click(this._onSaveClick.bind(this));

        this._saveSpinner = cloneTemplate('#loader_template img');
        this._saveSpinner.hide();
        saveButton.after(this._saveSpinner);

        if(this._dashboard.isAdmin) {
            // Hide "requires approval labels" for admins.
            $('.requires-admin', this._element).remove();
        }
    },

    open: function()
    {
        $.colorbox({
            inline: true,
            width: '700px',
            height: '562px',
            href: '#overlay_page'
        });
    },

    _makeTr: function(overlay)
    {
        var title = 'Created ' + formatTime(overlay.created);
        var url = makeSelfUrl({
            action: 'load',
            user_id: overlay.user_id,
            id: overlay.id
        });

        var tr = cloneTemplate('#overlay_template');
        $('a', tr).attr('href', 'javascript:;');

        $('.name', tr).text(overlay.name);
        $('.description', tr).text(overlay.description || '(none)');
        $('.login', tr).text(overlay.user_login || 'Unknown');
        $('.modified', tr).text(formatTime(overlay.modified));
        $('.modified', tr).attr('title', title);
        $('.publish_link', tr).click(this._onPublishClick.bind(this, overlay));
        $('.load_link', tr).click(this._onLoadClick.bind(this, overlay));
        $('.load_link', tr).attr('href', url);
        $('.delete_link', tr).click(this._onDeleteClick.bind(this, overlay));

        return tr;
    },

    _onPublishClick: function(overlay)
    {
        if(confirm('Are you sure you want to publish "' + overlay.name + '"?')) {
            this._dashboard.publishOverlay(overlay);
        }
    },

    _onDeleteClick: function(overlay)
    {
        if(confirm('Are you sure you want to delete "' + overlay.name + '"?')) {
            this._dashboard.deleteOverlay(overlay);
        }
    },

    /**
     * Fired when Dashboard's idea of available overlays changes, e.g. at page
     * load or after get_overlays().
     */
    _onOverlaysChange: function(overlays)
    {
        var tbody = $('#overlay_load_box tbody', this._element);
        tbody.children().remove();

        var login = this._dashboard.login;
        var isAdmin = this._dashboard.isAdmin;

        for(var i = 0; i < overlays.length; i++) {
            var overlay = overlays[i];
            var tr = this._makeTr(overlay);

            if(login != overlay.user_login && !isAdmin) {
                $('.can-delete', tr).remove();
            }

            if(! overlay.workspace) {
                $('span', tr).removeClass('is-workspace');
            }

            if(! overlay.pending) {
                $('.can-publish', tr).remove();
            }
            tr.appendTo(tbody);
        }
    },

    _onSaveClick: function()
    {
        this._saveSpinner.show();
        var rpc = this._dashboard.saveOverlay({
            name: $('#overlay_name').val(),
            description: $('#overlay_description').val(),
            shared: $('#overlay_shared')[0].checked
        });
        rpc.complete(this._onSaveComplete.bind(this));
    },

    _onSaveComplete: function(rpc)
    {
        this._saveSpinner.hide();
        if(! rpc.error) {
            $('#overlay_save_box input').val('');
            $.colorbox.close();
        }
    },

    _onLoadClick: function(overlay)
    {
        var rpc = this._dashboard.loadOverlay(overlay);
        rpc.done(this._onLoadDone.bind(this));
    },

    _onLoadDone: function()
    {
        $.colorbox.close();
    }
});


/**
 * Manages the general Dashboard user interface, including buttons and links
 * for adding/removing widgets to the WidgetView, the main setting dialog, and
 * notifications from the Dashboard instance to signal failures.
 */
var DashboardView = Base.extend({
    constructor: function(dashboard)
    {
        this._dashboard = dashboard;
        dashboard.notifyCb.add(this.notify.bind(this));
        this._overlayView = new OverlayView(dashboard);

        window.onbeforeunload = this._onWindowBeforeUnload.bind(this);

        this._setupUi();
    },

    /**
     * Handle user attempting to close the window/tab by requesting the browser
     * show a confirmation prompt, if the current workspace is unsaved.
     *
     * @param e
     *      BeforeUnload event object.
     */
    _onWindowBeforeUnload: function(e)
    {
        if(! this._dashboard.dirty) {
            return;
        }

        // Stupid evolved interface requires that this handler both set
        // returnValue and return a string, but despite that, both strings are
        // ignored (at least in Firefox) for security reasons.
        e.returnValue = 'You have unsaved changes.';
        return e.returnValue;
    },

    _setupUi: function()
    {
        $('a[id,class]:not([href]):').attr('href', 'javascript:;');

        var dash = this._dashboard;

        $('#button-overlay').click(this._onOpenOverlayClick.bind(this));
        $('#button-save-widgets').click(dash.save.bind(dash));
        $('#button-clear-workspace').click(this._onClearClick.bind(this));
        $('#button-add-column').click(dash.addColumn.bind(dash));
        $('#button-del-column').click(dash.deleteColumn.bind(dash));
        $('#button-reset-columns').click(dash.resetColumns.bind(dash));
        $('#button-new-url').click(dash.addWidget.bind(dash, 'url'));
        $('#button-new-mybugs').click(dash.addWidget.bind(dash, 'mybugs'));
        $('#button-new-rss').click(dash.addWidget.bind(dash, 'rss'));
        $('#button-new-text').click(dash.addWidget.bind(dash, 'text'));
        $('#button-new-bugs').click(dash.addWidget.bind(dash, 'bugs'));
    },

    _onClearClick: function()
    {
        if(confirm('Are you sure you want to clear your workspace?')) {
            this._dashboard.clear();
        }
    },

    notify: function(message)
    {
        $('#dashboard_notify').text(message);
    },

    _onOpenOverlayClick: function()
    {
        this._dashboard.getOverlays();
        this._overlayView.open();
    }
});


/**
 * Display a warning if the user's browser doesn't match the configured regex.
 * Block loading entirely if the browser is far too old.
 */
function checkBrowserQuality()
{
    var warn = DASHBOARD_CONFIG.browsers_warn;
    var block = DASHBOARD_CONFIG.browsers_block;

    if(warn && navigator.userAgent.match(RegExp(warn))) {
        $('#dashboard_notify').html($('#browser_warning_template'));
    } else if(block && navigator.userAgent.match(RegExp(block))) {
        $('#dashboard').html($('#browser_block_template'));
        throw ''; // Prevent further execution.
    }
}


/**
 * Main program implementation ('document.ready').
 *
 * Expects DASHBOARD_CONFIG global to be initialized by dashboard.html.tmpl
 * (which itself is populated by Extension.pm). This global contains various
 * configurables, and the initial workspace state (to avoid a redundant web
 * service roundtrip).
 */
function main()
{
    checkBrowserQuality();

    dashboard = new Dashboard(DASHBOARD_CONFIG);
    view = new DashboardView(dashboard);
    widgetView = new WidgetView(dashboard);

    dashboard.reset();
    dashboard.setOverlays(DASHBOARD_CONFIG.overlays);

    var params = getAnchorParams();
    if(params.action == 'load') {
        dashboard.loadOverlay({
            id: +params.id,
            user_id: +params.user_id
        });
    }
    window.location.hash = '';
}

$(document).ready(main);
