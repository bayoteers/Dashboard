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
 * Run a function, logging any exception thrown to the console. Used for
 * debugging XMLHTTPRequest event handlers, whose exceptions are silently
 * discarded.
 */
function absorb(fn)
{
    try {
        return fn();
    } catch(e) {
        console.error('absorb(): %o', e);
        throw e;
    }
}


/**
 * Make a GET URL from a dictionary of parametrrs.
 *
 * @param path
 *      Base URL (e.g. "buglist.cgi").
 * @param params
 *      Object whose property names and values become URL parameters.
 *      List-valued properties are repeated in the query string
 *      (e.g. {a: [1,2,3]} becomes "a=1&a=2&a=3".
 */
function makeUrl(path, params)
{
    var s = $.param(params, true);
    if(s) {
        path += (path.indexOf('?') == -1) ? '?' : '&';
        path += s;
    }
    return path;
}


/**
 * RPC object. Wraps the parameters of a Bugzilla RPC up along with callbacks
 * indicating completion state.
 */
var Rpc = Base.extend({
    /**
     * Create an instance.
     *
     * @param method
     *      Method name.
     * @param params
     *      Object containing method parameters.
     */
    constructor: function(method, params)
    {
        this.method = method;
        this.params = params;
        this.response = null;
        this.error = null;

        this.doneCb = jQuery.Callbacks();
        this.failCb = jQuery.Callbacks();
        this.completeCb = jQuery.Callbacks()

        // Fires on success; first argument is the RPC result.
        this.done = this.doneCb.add.bind(this.DoneCb);
        // Fires on failure; first argument is the RPC failure object.
        this.fail = this.failCb.add.bind(this.failCb);
        // Always fires; first argument is this RPC object.
        this.complete = this.completeCb.add.bind(this.completeCb);

        this._start();
    },

    /**
     * Start the RPC.
     */
    _start: function()
    {
        $.jsonRPC.setup({
            endPoint: 'jsonrpc.cgi',
            namespace: 'Dashboard'
        })

        $.jsonRPC.request(this.method, {
            params: [this.params || {}],
            success: this._onSuccess.bind(this),
            error: this._onError.bind(this)
        });
    },

    /**
     * Fired on success; records the RPC result and fires any callbacks.
     */
    _onSuccess: function(response)
    {
        this.response = response.result;
        var that = this;
        absorb(function()
        {
            that.doneCb.fire(response.result);
        });
    },

    /**
     * Fired on failure; records the error and fires any callbacks.
     */
    _onError: function(response)
    {
        this.error = response.error;
        if(typeof console !== 'undefined') {
            console.log('jsonRPC error: %o', this.error);
        }
        var that = this;
        absorb(function()
        {
            that.failCb.fire(response.error);
        });
    }
});


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

        // "outer" element; contains the title bar, controls, the settings box,
        // and the widget content area.
        this.element = null;
        // "content" element; contains the inner element (from the original
        // design, not sure why this exists).
        this.contentElement = null;
        // "inner" element; contains the actual widget content.
        this.innerElement = null;

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
        this.innerElement = $('.widget_inner', this.element);
        this.contentElement = $('.widget-content', this.element);

        this._child('.remove').click(this._onRemoveClick.bind(this));
        this._child('.refresh').click(this.reload.bind(this));
        this._child('.collapse').click(this._onMinimizeClick.bind(this));
        this._child('.maximize').click(this._onMaximizeClick.bind(this));

        this._child('.edit').click(this._onEditClick.bind(this));
        this._child('.save').click(this._onSaveClick.bind(this));
        this._child('.save').hide();

        //this.element.bind('resize', this._onResize.bind(this));
        this.element.bind('vertical_resize', this._onResize.bind(this));

        // Populate inner element with widget's template, if one exists.
        var sel = '#' + this.TEMPLATE_TYPE + '_widget_template';
        this.innerElement.append(cloneTemplate(sel));
    },

    /**
     * Override in subclass. Called when the widget's height or width changes.
     * The default implementation just adjuests the inner element's height to
     * match.
     */
    _onResize: function() {
        this.innerElement.height(this.element.height());
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

    _onEditClick: function(event)
    {
        this._restore();
        this._child('.edit').hide();
        this._child('.save').show();
        this._child('.edit-box').show();
    },

    _onSaveClick: function()
    {
        this._apply();
        this._dashboard.save();
        this._child('.edit').show();
        this._child('.save').hide();
        this._child('.edit-box').hide();
    },

    _onMaximizeClick: function() {
        var clone = cloneTemplate('#widget_maximized_hint')
        clone.click(closeMaximizedWidget.bind(this, this));
        this.contentElement.prepend(clone);
        this.contentElement.resizable('destroy');
        this.contentElement.addClass('widget-max');
        this.contentElement.css('position', '');

        $('.widget').not(this.element).hide();
        elem.show();

        var windowY = $(window).height() - 10;
        elem.height(windowY);
        $(window).trigger('resize');
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
        this._child('.widget-content').toggle(!state.minimized);

        this._setColor(state.color);
        this._setRefreshSecs(state.refresh);

        if(state.height == 1) {
            state.height = 70; // From old RSS widget. TODO
        }
        this.contentElement.height(state.height);
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
        Dashboard.save();
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
    _classes: {},

    DEFAULT_STATE: {
        color: 'gray',
        minimized: false,
        width: 0,
        height: 100 // from initWidget.
    },

    COLORS: ['gray', 'yellow', 'red', 'blue', 'white', 'orange', 'green'],

    addClass: function(type, klass) {
        klass.TYPE = type;
        this._classes[type] = klass;
    },

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
        this._child('iframe').height(this.innerElement.innerHeight());
    },

    // See Widget.setState().
    setState: function(state)
    {
        this.base(state);

        var iframe = this._child('iframe');
        if(iframe.attr('src') != this.state.URL) {
            iframe.attr('src', this.state.URL);
        }
    },

    // See Widget.reload().
    reload: function()
    {
        var iframe = this._child('iframe');
        iframe.attr('src', this.state.URL);
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

    // See Widget._apply().
    _apply: function()
    {
        this.base();
        this.update({
            URL: this._child('.field-URL').val()
        });
    },

    // See Widget.reload().
    reload: function()
    {
        this.innerElement.html(cloneTemplate('#loader_template'));
        var rpc = this._dashboard.getFeed(this.state.URL);
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
        this.innerElement.html(clone);
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

        this.innerElement.html(template);
        this.innerElement.trigger('vertical_resize');
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
        var s = html.replace(/^<.+>/,'');
        return s.replace(/<.+/g,'');
    },

    _onResize: function()
    {
        var y = this.innerElement.height();
        this._child('.rss').height(this.innerElement.height());
    }
}));


/**
 * My Bugs widget implementation.
 */
Widget.addClass('mybugs', Widget.extend({
    TEMPLATE_TYPE: 'rss',

    _makeFeedUrl: function()
    {
        return makeUrl('buglist.cgi', {
            bug_status: ['NEW', 'ASSIGNED', 'NEED_INFO', 'REOPENED', 'WAITING',
                'RESOLVED', 'RELEASED'],
            email1: this._dashboard.login,
            emailassigned_to1: 1,
            email_reporter1: 1,
            emailtype1: 'exact',
            'field0-0-0': 'bug_status',
            'field0-0-1': 'reporter',
            query_format: 'advanced',
            'type0-0-0': 'notequals',
            'type0-0-1': 'equals',
            'value0-0-0': 'UNCONFIRMED',
            'value0-0-1': this._dashboard.login,
            title: 'Bug List',
            ctype: 'atom'
        });
    },

    setState: function(state)
    {
        state.URL = this._makeFeedUrl();
        this.base(state);
    }
}));


/**
 * Dashboard 'model': this maintains the front end's notion of the workspace
 * state, which includes column widths, widget instances, user's login state,
 * and available overlay list.
 *
 * 'View' classes are expected to subscribe to the various *Cb callbacks, and
 * update their visual presentation based on, and *only* based on, the state
 * reflected by this model when the callback fires.
 *
 * This means visual changes associated with a mutation (e.g. resizing a
 * column) should not apply until after the callback. This only occurs after
 * the server has successfully stored the change, therefore the user can always
 * be sure what state their workspace will be in after a page reload.
 *
 * Methods are provided for saving state; they return Rpc objects. If some
 * visual update is required following a mutation (e.g. closing a dialog after
 * a saving an overlay), this should be done by subscribing to the ".done()"
 * event provided by the Rpc. This again ensures there are no illusions about
 * the success of an operation that actually failed.
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

        // Widgets existing in the user's workspace; always reflects the state
        // of backend store.
        this.widgets = [];

        // Columns existing in thte user's workspace; always reflects the state
        // of backend store.
        this.columns = [];

        // String user's login name.
        this.login = config.user_login;
        // Bool is user an admin.
        this.isAdmin = config.is_admin;
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
    setWorkspace: function(workspace)
    {
        while(this.widgets.length) {
            var widget = this.widgets.pop();
            this.widgetRemovedCb.fire(widget);
        }

        this.columns = workspace.columns;
        this.columnsChangeCb.fire(this.columns);

        for(var i = 0; i < workspace.widgets.length; i++) {
            var widget = Widget.createInstance(this, workspace.widgets[i]);
            this.widgets.push(widget);
            this.widgetAddedCb.fire(widget);
        }
    },

    getFeed: function(url)
    {
        return this.rpc('get_feed', { url: url });
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
        this.overlays = overlays;
        this.overlaysChangeCb.fire(overlays);
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
        var rpc = new Rpc(method, params);
        rpc.fail(function(e) { alert(e.message); });
        rpc.fail(this.notifyCb.fire.bind(this.notifyCb));
        return rpc;
    },

    /**
     * Ask the server to clear the user's workspace.
     */
    clearWorkspace: function()
    {
        var rpc = this.rpc('clear_workspace');
        rpc.done(this._onClearWorkspaceDone.bind(this));
        return rpc;
    },

    _onClearWorkspaceDone: function(workspace)
    {
        this.setWorkspace(workspace);
        this.notifyCb.fire('Workspace cleared.');
    },

    /**
     * Ask the server to add a column to the workspace.
     */
    addColumn: function()
    {
        var rpc = this.rpc('add_column');
        rpc.done(this._onAddColumnDone.bind(this));
        return rpc;
    },

    _onAddColumnDone: function(columns)
    {
        this.setColumns(columns);
        this.notifyCb.fire('Added a new column.');
    },

    /**
     * Reset column widths to be even.
     */
    resetColumns: function()
    {
        var width = Math.floor(100 / this.columns.length);
        var columns = [];
        for(var i = 0; i < this.columns.length; i++) {
            columns.push({ width: width });
        }

        var rpc = this.rpc('save_columns', { columns: columns });
        rpc.done(this._onResetColumnsDone.bind(this));
    },

    _onResetColumnsDone: function(columns)
    {
        this.setColumns(columns);
        this.notifyCb.fire('Column widths reset.');
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
        var id = this._getFreeWidgetId();
        var widget = Widget.createInstance(this, {
            id: id,
            title: 'Widget ' + id,
            type: type,
            col: 1, // wtf?
            pos: 99, // wtf?
        });

        var rpc = this.rpc('save_widget', widget.state);
        rpc.done(this._onAddWidgetDone.bind(this, widget));
        return rpc;
    },

    _onAddWidgetDone: function(widget, response)
    {
        this.widgets.push(widget);
        this.notifyCb.fire('Created ' + widget.state.type + ' widget.');
        this.widgetAddedCb.fire(widget);
    },

    /**
     * Ask the server to save a widget's state.
     *
     * @param widget
     *      Widget object.
     */
    saveWidget: function(widget)
    {
        var rpc = this.rpc('save_widget', widget.state);
        rpc.done(this._onSaveWidgetDone.bind(this, widget));
        return rpc;
    },

    _onSaveWidgetDone: function(widget, response)
    {
        this.notifyCb.fire('Saved settings for ' + widget.state.title + '!');
    },

    /**
     * Ask the server to delete a widget.
     *
     * @param widget
     *      Widget object.
     */
    deleteWidget: function(widget)
    {
        var rpc = this.rpc('delete_widget', { id: widget.state.id });
        rpc.done(this._onDeleteWidgetDone.bind(this, widget));
        return rpc;
    },

    _onDeleteWidgetDone: function(widget, response) {
        this.widgetRemovedCb.fire(widget);
        this.notifyCb.fire('Deleted widget: ' + widget.state.title);
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
        var rpc = this.rpc('load_overlay', {
            id: overlay.id,
            user_id: overlay.user_id
        });
        rpc.done(this._onLoadOverlayDone.bind(this, overlay));
        return rpc;
    },

    _onLoadOverlayDone: function(overlay, workspace)
    {
        this.setWorkspace(workspace);
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
        var rpc = this.rpc('save_overlay', overlay);
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
     * Ask the server to delete a trailing empty column.
     */
    deleteColumn: function()
    {
        var rpc = this.rpc('delete_column');
        rpc.done(this._onDeleteColumnDone.bind(this));
        return rpc;
    },

    _onDeleteColumnDone: function(columns)
    {
        this.setColumns(columns);
        this.notifyCb.fire('Removed column!');
    },

    /**
     * Ask the server to record some column widths.
     *
     * @param columns
     *      Column objects in the format of this.columns.
     */
    saveColumns: function(columns)
    {
        var rpc = this.rpc('save_columns', { columns: columns });
        rpc.done(this._onSaveColumnsDone.bind(this));
        return rpc;
    },

    _onSaveColumnsDone: function(columns)
    {
        this.setColumns(columns);
        this.notifyCb.fire('Columns saved.');
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
     * Save the current workspace state.
     */
    save: function()
    {
        var rpc = this.rpc('save_workspace', {
            columns: this.columns,
            widgets: this._getWidgetStates()
        });
        return rpc;
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
        $(window).bind('resize', this._updateColumnWidths.bind(this));
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

        this._insertWidget(widget);
        widget.element.trigger('vertical_resize');
        this._makeWidgetResizable(widget);
        this._makeSortable();
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
        if(! this._maximizedWidget) {
            return;
        }

        var widget = this._maximizedWidget;
        this._maximizedWidget = null;

        widget.element.removeClass('widget-max');
        widget.child('.maximized-hint').remove();

        widget.contentElement.height(widget.state.height);
        this._makeWidgetResizable(widget);

        $(".widget").show();
        this._updateColumnWidths();
    },

    _makeWidgetResizable: function(widget)
    {
        widget.contentElement.resizable({
            handles: 'e, s, se',
            minWidth: 75,
            helper: 'widget-state-highlight',
            start: this._disableIframes,
            stop: this._onWidgetResizeStop.bind(this, widget)
        });
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
     *      Widget object passed from _makeWidgetResizable().
     */
    _onWidgetResizeStop: function(widget)
    {
        this._enableIframes();

        var content = widget.contentElement;
        var newPct = Math.floor(100 * (content.width() / (55 + this._element.width())));
        content.css('width', '');

        widget.update({ height: content.height() });
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
    _getMaxGrowth: function()
    {
        var last = this._columns[this._columns.length - 1];
        return Math.max(0, last.width() - this.MIN_WIDTH);
    },

    /**
     * After a resize (and manually at various other times), reset the column
     * widths proportional to the new container size.
     */
    _updateColumnWidths: function()
    {
        var pct = (this._element.width() - 4) / 100;
        var maxGrowth = this._getMaxGrowth();

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
                    maxWidth: (info.width * pct) + maxGrowth,
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
            width: '665px',
            height: '562px',
            href: '#overlay_page'
        });
    },

    _makeTr: function(overlay)
    {
        var tr = cloneTemplate('#overlay_template');
        $('.name', tr).text(overlay.name);
        $('.description', tr).text(overlay.description);
        $('.login', tr).text(overlay.user_login || 'unknown author');
        $('.publish_link', tr).click(this._onPublishClick.bind(this, overlay));
        $('.load_link', tr).click(this._onLoadClick.bind(this, overlay));
        $('.delete_link', tr).click(this._onDeleteClick.bind(this, overlay));

        $('a', tr).attr('href', 'javascript:;');
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
            $('#overlay_save_box').children().remove();
            $('#overlay_save_box').prepend(result);
            $.colorbox.resize();
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
 * Display a small progress indicator at the top of the document while any
 * jQuery XMLHTTPRequest is in progress.
 */
var RpcProgressView = Base.extend({
    constructor: function()
    {
        this._active = 0;
        this._progress = cloneTemplate('#in_progress_template');
        this._progress.hide();
        this._progress.appendTo('body');
        $(document).ajaxSend(this._onAjaxSend.bind(this));
        $(document).ajaxComplete(this._onAjaxComplete.bind(this));
    },

    /**
     * Handle request start by incrementing the active count.
     */
    _onAjaxSend: function()
    {
        this._active++;
        this._progress.show();
    },

    /**
     * Handle request copmletion by decrementing the active count, and hiding
     * the progress indicator if there are no more active requests.
     */
    _onAjaxComplete: function()
    {
        this._active--;
        if(! this._active) {
            this._progress.hide();
        }
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
        this._setupUi();
    },

    _setupUi: function()
    {
        $('a[id,class]:not([href]):').attr('href', 'javascript:;');

        var dash = this._dashboard;

        $('#button-overlay').click(this._onOpenOverlayClick.bind(this));
        $('#button-save-widgets').click(dash.save.bind(dash));
        $('#button-clear-workspace').click(dash.clearWorkspace.bind(dash));
        $('#button-add-column').click(dash.addColumn.bind(dash));
        $('#button-del-column').click(dash.deleteColumn.bind(dash));
        $('#button-reset-columns').click(dash.resetColumns.bind(dash));
        $('#button-new-url').click(dash.addWidget.bind(dash, 'url'));
        $('#button-new-mybugs').click(dash.addWidget.bind(dash, 'mybugs'));
        $('#button-new-rss').click(dash.addWidget.bind(dash, 'rss'));
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

    progress = new RpcProgressView();
    dashboard = new Dashboard(DASHBOARD_CONFIG);
    view = new DashboardView(dashboard);
    widgetView = new WidgetView(dashboard);

    dashboard.setWorkspace(DASHBOARD_CONFIG.workspace);
    dashboard.setOverlays(DASHBOARD_CONFIG.overlays);

    if(! dashboard.widgets.length) {
        view._overlayView.open();
    }
}

$(document).ready(main);
