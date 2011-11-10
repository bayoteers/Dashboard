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
        this.doneCb.fire(response.result);
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
        this.failCb.fire(response.error);
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
        this.TYPE = this.constructor.TYPE;

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
        this._child('.collapse').click(this._onCollapseClick.bind(this));
        this._child('.edit').click(this._onEditClick.bind(this));
        this._child('.maximize').click(this._onMaximizeClick.bind(this));

        //this.element.bind('resize', this._onResize.bind(this));
        this.element.bind('vertical_resize', this._onResize.bind(this));

        // Populate inner element with widget's template, if one exists.
        var sel = '#' + this.TYPE + '_widget_template';
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

    _onColorClick: function(color)
    {
        this.updateState({
            color: color
        });
    },

    /**
     * Extend in subclass; default implementation just appends the default
     * name, title, color, and refresh interval options.
     */
    renderSettings: function()
    {
        var clone = $('#base_widget_settings_template').clone();
        clone.removeAttr('id');
        clone.append

        var list = $('.colors', clone);
        for(var i = 0; i < Widget.COLORS.length; i++) {
            var color = Widget.COLORS[i];
            var item = $('<li>');
            item.addClass('color-' + color);
            item.click(this._onColorClick.bind(this, color));
            item.appendTo(list);
        }

        var sel = '#' + this.TYPE + '_widget_settings_template';
        var template = cloneTemplate(sel);
        template.children().appendto(this._child('.edit-box'));
    },

    _onEditClick: function(event)
    {
        var editBox = this._child('.edit-box');
        if(event.target.className == 'edit') {
            editBox.show();
            event.target.className = 'save';
        } else {
            editBox.hide();
            this._dashboard.save();
            event.target.className = 'edit';
        }
    },

    _onMaximizeClick: function() {
        var elem = this._contentElement;

        //settings.height = elem.height();

        var clone = cloneTemplate('#widget_maximized_hint')
        clone.click(closeMaximizedWidget.bind(this, this));
        elem.prepend(clone);

        elem.resizable('destroy');
        elem.addClass('widget-max');
        elem.css('position', '');

        $('.widget').not(this.element).hide();
        elem.show();

        var windowY = $(window).height() - 10;
        elem.height(windowY);
        $(window).trigger('resize');
    },

    /**
     * Update just a few widget parameters.
     */
    updateState: function(state)
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

        this._child('.remove').toggle(state.removable);
        this._child('.refresh').toggle(state.refreshable);
        this._child('.collapse').toggle(state.collapsible);
        this._child('.maximize').toggle(state.maximizable);
        this._child('.edit').toggle(state.editable);
        this._child('.widget-content').toggle(!state.collapsed);

        this._setColor(state.color);
        this._setRefreshSecs(state.refresh);

        if(state.height == 1) {
            state.height = 70; // From old RSS widget. TODO
        }
        this.innerElement.height(state.height);

        this._child('.widget-title').text(state.title);
        this._child('.widget-title').keyup(this._onTitleKeyup.bind(this));

        this.reload();
    },

    /**
     * Color the widget frame as appropriate.
     */
    _setColor: function(color)
    {
        if(color) {
            this.element.addClass('color-' + color);
        }

        var oldColor = this.element.data('color');
        if(oldColor) {
            this.element.removeClass('color-' + oldColor);
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
     *
     * @param sel
     *      jQuery selector.
     * @returns
     *      jQuery object.
     */
    _child: function(sel)
    {
        return $(sel, this.element);
    },

    _onCollapseClick: function()
    {
        this.updateState({
            collapsed: !this.state.collapesd
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

    _onTitleKeyup: function()
    {
        var value = this._child('.field-title').val();
        this._child('.widget-title').text(value);
    },

    reload: function()
    {
        // Override in subclass.
    }
}, /* class variables: */ {
    _classes: {},

    DEFAULT_STATE: {
        color: 'gray',
        movable: true,
        removable: true,
        collapsible: true,
        editable: true,
        resizable: true,
        maximizable: true,
        refreshable: true,
        controls: true,
        width: 0,
        height: 100, // from initWidget.
        refresh_id: 0,
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
    },

    // See Widget._onResize().
    _onResize: function()
    {
        this.base();
        this._child('iframe').height(this.innerElement.innerHeight());
    },

    // See Widget.reload().
    reload: function()
    {
        var iframe = this._child('iframe');
        iframe.attr('src', this.state.URL);
    }
}));


/**
 * Xeyes widget implementation.
 */
Widget.addClass('xeyes', Widget.extend({

    destroy: function()
    {
        document.unbind('mousemove.' + this.state.id);
        this.base();
    }
}));


/**
 * RSS widget implementation.
 */
Widget.addClass('rss', Widget.extend({
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

    reload: function()
    {
        this.innerElement.html(cloneTemplate('#loader_template'));
        jQuery.getFeed({
            url: this.state.URL,
            error: this._onLoadError.bind(this),
            success: this._onLoadSuccess.bind(this)
        });
    },

    _onLoadError: function(error)
    {
        var clone = cloneTemplate('#rss_widget_error');
        $('.error-text', clone).text(error);
        this.innerElement.html(clone);
    },

    _onLinkClick: function(openPopup, event)
    {
        event.preventDefault();
        if(openPopup) {
            $(this).colorbox({
                width: "80%",
                height: "80%",
                iframe: true
            });
        } else {
            window.open(event.target.href);
        }
    },

    _sanitize: function(html)
    {
        // TODO
        var s = html.replace(/^<.+>/,'');
        return s.replace(/<.+/g,'');
    },

    _formatItem: function(item)
    {
        var template = cloneTemplate('#mybugs_item_template');
        var item = feed.items[i];

        $('h3', template).text(item.title);
        $('.updated-text', template).text(item.updated);
        $('.description-text', template).text(this._sanitize(item.description));
        template.appendTo(clone);

        var links;
        links = $('.open_popup', template);
        links.attr('href', item.link);
        links.click(this._onLinkClick.bind(this, true));

        links = $('.open_link', template);
        links.attr('href', item.link);
        links.click(this._onLinkClick.bind(this, false));
        return template;
    },

    _onResize: function()
    {
        var y = this.innerElement.height() - 3;
        this._child('.rss').height(y);
    },

    _onLoadSuccess: function(feed)
    {
        var template = cloneTemplate('#mybugs_widget_template');

        if(feed.link.length) {
            $('h2 a', template).attr('href', feed.link);
            $('h2 a', template).text(feed.title);
        } else {
            $('h2', template).text(feed.title);
        }

        var length = Math.min(feed.items.length, this.MAX_ITEMS); // TODO
        for(var i = 0; i < length; i++) {
            template.append(this._formatItem(feed.items[i]));
        }

        this.innerElement.html(template);
        this.innerElement.trigger('vertical_resize');
    }
}));


/**
 * My Bugs widget implementation.
 */
Widget.addClass('mybugs', Widget.extend({
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

        this.columns = [];
        this.columnsChangeCb.fire(this.columns);

        for(var i = 0; i < workspace.widgets.length; i++) {
            var widget = Widget.createInstance(this, workspace.widgets[i]);
            this.widgets.push(widget);
            this.widgetAddedCb.fire(widget);
        }
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
        rpc.fail(this.notifyCb.fire.bind(this.notifyCb));
        return rpc;
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
        this.notifyCb.fire('Removed widget ' + widget.state.title);
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
            id: overlay.overlay_id,
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
        this.notifyCb.fire('Saved overlay: ' + overlay.title);
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
        this.setColumns(columns);
        return; // TODO
        var rpc = this.rpc('save_columns', columns);
        rpc.done(this._onSaveColumnsDone.bind(this));
        return rpc;
    },

    _onSaveColumnsDone: function(columns)
    {
        this.setColumns(columns);
        this.notifyCb.fire('Columns saved.');
    },

    /**
     * Return an array describing state of columns in the workspace, as
     * understood by 'save_workspace' RPC.
     *
     * @returns
     *      Array of objects containing (initially) column widths.
     */
    _getColumnStates: function()
    {
        return;
        var elems = $('.column:not(#column-1)');
        return $.map(elems, function(index, col)
        {
            return { width: +$(col).css('width') };
        });
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
            columns: this._getColumnStates(),
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
        var s = widget.state.resizable ? 'enable' : 'disable';
        widget.contentElement.resizable(s);
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
            handles: 's',
            minWidth: 75,
            helper: 'widget-state-highlight',
            stop: this._onWidgetResizeStop.bind(this, widget)
        });
    },

    _onWidgetResizeStop: function(widget)
    {
        var resizedWidth = widget.contentElement.width() + 55;
        var colId = widget.state.col;
        var col = $('#column' + colId);
        var colWidthPx = col.width();
        var colWidthPct = parseInt(col.css('width'));

        widget.contentElement.css('width', '');

        var newWidthPct = Math.max(10, Math.round(colWidthPct / colWidthPx * resizedWidth));
        var deltaWidthPct = Math.round((colWidthPct - newWidthPct) / ($('.column').length - 1));

        $('.column:not(#' + colId + ',#column-1)').each(function(index) {
            var curWidthPct = Math.max(10, deltaWidthPct + widget.contentElement.css('width'));
            $(this).css('width', curWidthPct + '%');
        });

        this._updateColumnWidths();
        widget.element.trigger('vertical_resize');
        widget.updateState();
        this._dashboard.save();
    },

    /**
     * 
     */
    _onColumnResizeStop: function(idx)
    {
        var helper = $('.column_helper', this._columns[idx]);

        var oldPct = this._dashboard.columns[idx].width;
        var newPct = Math.floor(100 * (helper.width() / this._element.width()));
        var deltaPct = oldPct - newPct;
        helper.css('width', '100%');

        // Make a new column information structure and save it on the server.
        // saveColumns() will fire columnsChangeCb on success, which will cause
        // the actual resize to occur.
        var cols = $.extend(true, [], this._dashboard.columns);
        cols[idx].width -= deltaPct;
        cols[cols.length - 1].width += deltaPct;

        this._dashboard.saveColumns(cols);
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
            if(widget.state.movable) {
                sortable.push(widget.element);
            }
        }
        return sortable;
    },

    // make the columns Sortable
    _makeSortable: function()
    {
        var sortable = this._getSortableWidgetElements();
        var heads = $('.widget-head', sortable);

        heads.css('cursor', 'move');
        heads.mousedown(function(e) {
            sortable.css('width', '');
            var widget = $(this).parent();
            widget.css('width', widget.width() + 'px');
        });
        heads.mouseup(function() {
            var widget = $(this).parent();
            if (!widget.hasClass('dragging')) {
                $(this).parent().css('width', '');
            } else {
                $('.column').sortable('disable');
            }
        });

        $('.column').sortable({
            items: sortable,
            connectWith: $('.column'),
            handle: '.widget-head',
            placeholder: 'widget-placeholder',
            forcePlaceholderSize: true,
            revert: 300,
            delay: 100,
            opacity: 0.8,
            tolerance: 'pointer',
            containment: 'document',
            start: this._onSortStart.bind(this),
            stop: this._onSortStop.bind(this)
        });
    },

    _onSortStart: function(e, ui) {
        $(ui.helper).addClass('dragging');
    },

    _onSortStop: function(e, ui) {
        $(ui.item).css('width', '');
        $(ui.item).removeClass('dragging');
        $('.column').sortable('enable');
        $(window).trigger("resize");
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
        } else {
            // Hide pending box for non-admin users.
            $('#overlay_pending_box').remove();
        }
    },

    open: function()
    {
        $.colorbox({
            inline: true,
            width: '450px',
            height: '400px',
            href: '#overlay_page'
        });
    },

    _makeTr: function(overlay)
    {
        var tr = cloneTemplate('#overlay_template');
        $('.overlay-name', tr).text(overlay.name);
        $('.overlay-description', tr).text(overlay.description);
        $('.overlay-login', tr).text(overlay.user_login);
        $('.overlay_publish_link', tr).click(
            this._onPublishClick.bind(this, overlay));
        $('.overlay_load_link', tr).click(
            this._onLoadClick.bind(this, overlay));
        $('#overlay_delete_link', tr).click(
            this._onDeleteClick.bind(this, overlay));

        $('a', tr).attr('href', 'javascript:;');
        return tr;
    },

    _onPublishClick: function(overlay)
    {
        this._dashboard.publishOverlay(overlay);
    },

    _onDeleteClick: function(overlay)
    {
        this._dashboard.deleteOverlay(overlay);
    },

    /**
     * Fired when Dashboard's idea of available overlays changes, e.g. at page
     * load or after get_overlays().
     */
    _onOverlaysChange: function(overlays)
    {
        var published = $('#overlay_load_box tbody', this._element);
        var pending = $('#overlay_pending_box tbody', this._element);

        published.children().remove();
        pending.children().remove();

        var login = this._dashboard.login;
        var isAdmin = this._dashboard.isAdmin;

        for(var i = 0; i < overlays.length; i++) {
            var overlay = overlays[i];
            var tr = this._makeTr(overlay);

            if(login != overlay.user_login && !isAdmin) {
                $('.can-delete', tr).remove();
            }

            if(overlay.pending) {
                tr.appendTo(pending);
            } else {
                $('.can-publish', tr).remove();
                tr.appendTo(published);
            }
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
        this._dashboard.loadOverlay(overlay);
    }
});


var RpcProgressView = Base.extend({
    constructor: function()
    {
        this._progress = cloneTemplate('#in_progress_template');
        this._progress.hide();
        this._progress.appendTo('body');
        $('.cancel', this._progress).click(this._onCancelClick.bind(this));

        $.ajaxSetup({
            beforeSend: this._onAjaxBeforeSend.bind(this)
        });
    },

    _onAjaxBeforeSend: function(xhr)
    {
        xhr.complete(this._onComplete.bind(this));
    },

    _onComplete: function(xhr)
    {
        this._progress.hide();
        this._lastRpc = null;
    },

    _onCancelClick: function()
    {
        if(this._lastRpc) {
            this._lastRpc.abort();
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
        $('a[id]:not([href]):').attr('href', 'javascript:;');

        var dash = this._dashboard;

        $('#settingsLink').click(this.openSettings.bind(this));
        $('#openOverlayButton').click(this._onOpenOverlayClick.bind(this));
        $('#addColumnButton').click(dash.addColumn.bind(dash));
        $('#savePrefsButton').click(dash.save.bind(dash));
        $('#deleteColumnButton').click(dash.deleteColumn.bind(dash));

        $('#reloadLink').click(
            window.location.reload.bind(window.location));

        $('#newUrlButton').click(dash.addWidget.bind(dash, 'url'));
        $('#newMyBugsButton').click(dash.addWidget.bind(dash, 'mybugs'));
        $('#newRssButton').click(dash.addWidget.bind(dash, 'rss'));
        $('#newXeyesButton').click(dash.addWidget.bind(dash, 'xeyes'));
    },

    notify: function(message)
    {
        $('#dashboard_notify').text(message);
    },

    openSettings: function()
    {
        $.colorbox({
            width: '384px',
            inline: true,
            href: '.dashboard-main'
        });
    },

    _onOpenOverlayClick: function()
    {
        this._overlayView.open();
    }
});


function checkBrowserQuality()
{
    var warn = DASHBOARD_CONFIG.browsers_warn;
    var block = DASHBOARD_CONFIG.browsers_block;

    if(warn && navigator.userAgent.match(RegExp(warn))) {
        var template = cloneTemplate('#browser_warning_template');
        setBoxContent('#dashboard_notify', template);
    } else if(block && navigator.userAgent.match(RegExp(block))) {
        template = cloneTemplate('#browser_block_template');
        setBoxContent('#dashboard', template);
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

    if(DASHBOARD_CONFIG.widget_error) {
        alert(DASHBOARD_CONFIG.widget_error);
    }

    var progress = new RpcProgressView();
    dashboard = new Dashboard(DASHBOARD_CONFIG);
    var view = new DashboardView(dashboard);
    var widgetView = new WidgetView(dashboard);

    dashboard.setWorkspace(DASHBOARD_CONFIG.workspace);
    dashboard.setOverlays(DASHBOARD_CONFIG.overlays);

    if(! dashboard.widgets.length) {
        //view.openSettings();
    }
}

$(document).ready(main);
