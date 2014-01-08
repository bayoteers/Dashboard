/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * The Initial Developer of the Original Code is "Nokia Corporation"
 * Portions created by the Initial Developer are Copyright (C) 2011 the
 * Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *      David Wilson <ext-david.3.wilson@nokia.com>
 *      Jari Savolainen <ext-jari.a.savolainen@nokia.com>
 *      Pami Ketolainen <pami.ketolainen@jollamobile.com>
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
 * Compare two widgets (state hash) by position.
 *
 * Used to sort the widget array in order which can be easily pushed on overlay
 */
function widgetPosCmp(a, b)
{
    if (a.col == b.col) {
        return a.pos - b.pos;
    } else {
        return a.col - b.col;
    }
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
 * The default render() prepopulates the widget's content element with a
 * "#widget-template-<type>" and adds "#widget-settings-template-<type>" to the
 * settings dialog. Both templates are expected to be defined in
 * dashboard.html.tmpl.
 *
 * Any field value in the settings dialog template with class 'custom-field'
 * and name attribute gets automatically transfered to and from
 * widget.state.data. If something else is require, subclass shoud override
 * _setCustomSetting() and _getCustomSettings() methods.
 *
 * In the simplest scenario the subclass only needs to implement reload() method
 * to display the desired content in the widget content element.
 *
 * When templates are rendered, the click event of any <button> element with
 * attribute 'name' is bound to onClick<Name>() method, where <Name> is the
 * value of name attribute with first letter capitalized.
 *
 *
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

        // Fired when widget is removed
        this.onRemoveCb = new jQuery.Callbacks();
        // Fired when widget is maximized
        this.onMaximizeCb = new jQuery.Callbacks();
        // Fired when the widget state changes
        this.stateChangeCb = new jQuery.Callbacks();

        this.id = Widget.counter++;

        if(! this.TYPE) {
            this.TYPE = this.constructor.TYPE;
        }
        if(! this.TEMPLATE_TYPE) {
            this.TEMPLATE_TYPE = this.TYPE;
        }

        this.state = $.extend({
                color: 'none',
                minimized: false,
                height: 100,
                refresh: 0,
                data: {}
            }, state);
        this.render();
        this._applyState();
    },

    /**
     * Updates the widget.state and fires stateChangeCb if changes were
     * introduced.
     *
     * @param changes - New state values
     */
    updateState: function(changes)
    {
        var stateChanges = $.extend({}, changes);
        var dataChanges = stateChanges.data;

        // Remove unknown and unchanged values
        for (var key in stateChanges) {
            if (Widget.STATE_KEYS.indexOf(key) == -1 ||
                    this.state[key] == stateChanges[key]) {
                delete stateChanges[key];
            }
        }
        var changed = false;
        if (!$.isEmptyObject(stateChanges)) {
            $.extend(this.state, stateChanges);
            changed = true;
        }

        // Update widget type specific data
        changed = this._updateStateData(dataChanges) || changed;

        // Apply changes and fire the event
        if (changed) {
            this.stateChangeCb.fire(this);
            this._applyState();
        }
        return changed;
    },

    /**
     * Updates the widget type specific state.data
     *
     * @param changes - Object containin values to update in state.data
     * @returns True if something has changed in state.data
     *
     * Default implementation only compares state.data[key] == changes[key]
     * so this needs to be overriden in the subclass if widget stores more
     * complex values in the data object.
     */
    _updateStateData: function(changes)
    {
        var changes = $.extend({}, changes);
        for (var key in changes) {
            if (this.state.data[key] == changes[key]) {
                delete changes[key];
            }
        }
        if ($.isEmptyObject(changes)) {
            return false;
        } else {
            $.extend(this.state.data, changes);
            return true
        }
    },

    /**
     * Renders the widget ui from templates.
     */
    render: function()
    {
        // The top level container
        this.element = cloneTemplate('#widget-template');
        this.element.attr("id", "widget_" + this.id);
        this.element.addClass(this.TYPE + '-widget');
        // The header element, containing title and buttons
        this.headerElement = this._child(".widget-header");
        // The resizable container
        this.containerElement = this._child(".widget-container");
        // The actual widget content container
        this.contentElement = this._child(".widget-content");
        // Notification container
        this.statusElement = this._child(".widget-status");

        this._child(".widget-buttons [name='maximize']").button(
                {text:false, icons:{primary:"ui-icon-circle-plus"}});
        this._child(".widget-buttons [name='minimize']").button(
                {text:false, icons:{primary:"ui-icon-circle-minus"}});
        this._child(".widget-buttons [name='remove']").button(
                {text:false, icons:{primary:"ui-icon-circle-close"}});
        this._child(".widget-buttons [name='edit']").button(
                {text:false, icons:{primary:"ui-icon-wrench"}});
        this._child(".widget-buttons [name='refresh']").button(
                {text:false, icons:{primary:"ui-icon-refresh"}});

        // Populate content element with widget's template, if one exists.
        var sel = '#widget-template-' + this.TEMPLATE_TYPE;
        this.contentElement.append(cloneTemplate(sel));


        // Prepare settings dialog
        this.settingsDialog = this._child('.settings-dialog');
        this.settingsDialog.attr("id", "widget_settings_" + this.id);
        var colorSelect = $("[name='color']", this.settingsDialog);
        for(var bg in Widget.COLORS) {
            var fg = Widget.COLORS[bg];
            var item = $('<option />');
            item.html(bg);
            item.attr("value", bg);
            item.css({"background-color": bg, "color": fg});
            colorSelect.append(item);
        }

        // Append custom widget settings
        var sel = '#widget-settings-template-' + this.TEMPLATE_TYPE;
        var template = cloneTemplate(sel);
        this.settingsDialog.find("form").append(template);


        // Bind any buttons to automatic callbacks
        var widget = this;
        this._child(":button").each(function() {
            var name = $(this).attr("name");
            if (!name) return;
            var method = "onClick" + name[0].toUpperCase() + name.slice(1).toLowerCase();
            // this is the button element in this context
            $(this).click($.proxy(widget, method));
        });

        // Initialize the settings dialog
        this.settingsDialog.dialog({
            autoOpen: false,
            modal: true,
            width: 500,
            zIndex: 9999,
            buttons: {
                "Apply": $.proxy(this, "_onSettingsApply"),
                "Cancel": function(){ $(this).dialog("close") }
            }
        });

        // Make widget resizable
        this.containerElement.resizable({
            handles:"s",
            grid: [1, 16],
            helper: "widget-resize-helper",
            minHeight: Widget.MIN_HEIGHT,
            start: $.proxy(this, "_onResizeStart"),
            stop: $.proxy(this, "_onResizeStop")
        });
    },

    _onResizeStart: function()
    {
        // Iframes can eat mouse events, so we need to hide them
        $(".widget-content iframe").hide();
    },

    /**
     * Handle the resize event
     */
    _onResizeStop: function()
    {
        $(".widget-content iframe").show();
        // jquery ui resizable forces all dimensions, but we want width from
        // the parent overaly column.
        this.containerElement.css("width", "");
        this.updateState({height: this.containerElement.height()});
    },

    /**
     * Widget title bar maximize button click
     */
    onClickMaximize: function()
    {
        this.element.toggleClass("widget-max");
        this.headerElement.toggleClass("widget-header-maximized");
        this._child("button[name='remove']").toggle();
        this._child("button[name='minimize']").toggle();
        this._child("button[name='maximize'] .ui-button-icon-primary").toggleClass(
                "ui-icon-circle-plus ui-icon-arrowthick-1-sw");

        if (this.element.hasClass("widget-max")) {
            this.containerElement.css("height", "100%");
            if (this.state.minimized) {
                this.headerElement.removeClass("ui-corner-bottom");
                this.containerElement.slideDown("fast");
            }
            this.onMaximizeCb.fire(true);
        } else {
            this.containerElement.css("height", this.state.height);
            if (this.state.minimized) {
                this.headerElement.addClass("ui-corner-bottom");
                this.containerElement.slideUp("fast");
            }
            this.onMaximizeCb.fire(false);
        }

    },

    /**
     * Widget title bar minimize button click
     */
    onClickMinimize: function()
    {
        if (this.state.minimized) {
            this.headerElement.removeClass("ui-corner-bottom");
            this.containerElement.slideDown("fast");
            this.updateState({minimized: false});
        } else {
            this.headerElement.addClass("ui-corner-bottom");
            this.containerElement.slideUp("fast");
            this.updateState({minimized: true});
        }
    },

    /**
     * Widget title bar remove button click
     */
    onClickRemove: function()
    {
        if (confirm("Do you really want to remove this widget?")) {
            this.destroy();
            this.onRemoveCb.fire(this);
        }
    },

    /**
     * Widget title bar refresh button click
     */
    onClickRefresh: function()
    {
        this.reload();
    },

    /**
     * Widget title bar edit button click
     */
    onClickEdit: function()
    {

        this._setSettings();
        this.settingsDialog.dialog("open");
    },

    /**
     * Handler for settings dialog apply button click.
     */
    _onSettingsApply: function()
    {
        var state = this._getSettings();
        this.settingsDialog.dialog("close");
        if (this.updateState(state)) {
            this.reload();
        }
    },

    /**
     * Sets values in the widget settings dialog.
     */
    _setSettings: function()
    {
        var self = this;
        this.settingsDialog.find(".settings-field").each(function() {
            var key = $(this).attr("name");
            if(!key) return;
            $(this).val(self.state[key]);
        });
        this._setCustomSetting();
    },

    /**
     * Sets the widget specific setting values in the settigns dialog.
     *
     * Default implementation sets value to each form element with class
     * 'custom-field' in the settings dialog from this.state.data[<name>],
     * where <name> is the form element name attribute. Override in subclass,
     * if special processing is required.
     */
    _setCustomSetting: function()
    {
        var self = this;
        this.settingsDialog.find(".custom-field").each(function() {
            var key = $(this).attr("name");
            if(!key) return;
            $(this).val(self.state.data[key]);
        });
    },

    /**
     * Gets settings values from widget settings dialog.
     */
    _getSettings: function()
    {
        var state = {};
        this.settingsDialog.find(".settings-field").each(function() {
            var key = $(this).attr("name");
            if(!key) return;
            state[key] = $(this).val();
        });
        state.data = this._getCustomSettings();
        return state;
    },

    /**
     * Gets the widget type specific settings from the settings dialog
     *
     * Default implementation gets value (.val()) from each element with
     * class 'custom-field'. Override in subclass if special processing is
     * required.
     *
     * @returns Object presenting the state.data
     */
    _getCustomSettings: function()
    {
        var data = {};
        this.settingsDialog.find(".custom-field").each(function() {
            var key = $(this).attr("name");
            if(!key) return;
            data[key] = $(this).val();
        });
        return data;
    },

    /**
     * Aplies the state to widget UI.
     */
    _applyState: function()
    {
        window.clearInterval(this._refreshInterval);
        if(+this.state.refresh){
            this._refreshInterval = window.setInterval($.proxy(this, "reload"),
                    1000 * this.state.refresh)
        }

        var color = this.state.color == "none" ? "" : this.state.color;
        this.headerElement.css({
                "background": color,
                "color": Widget.COLORS[color]
        });
        this._child(".widget-header, .widget-container")
            .css("border-color", color);

        this._child(".widget-title").html(this.state.name);

        this.containerElement.css("height", this.state.height);

        if (this.state.minimized) {
            this.headerElement.addClass("ui-corner-bottom");
            this.containerElement.hide();
        }

        this._applyCustomState();
    },

    /**
     * Execute any actions required to apply widget specific settings
     */
    _applyCustomState: function()
    {
        // Implement in the subclass, if some actions are needed when state
        // changes.
    },

    /**
     * Reloads the widget content.
     */
    reload: function()
    {
        this.statusElement.empty();
    },

    /**
     * Removes the widget
     */

    destroy: function() {
        this.element.remove();
    },

    /**
     * Displays error text in widget status box
     */
    error: function(text)
    {
        if (text != undefined) {
            var clone = cloneTemplate('#widget-template-error');
            $('.error-text', clone).text(text);
            this.statusElement.html(clone);
        } else {
            this.statusElement.empty();
        }
    },
    /**
     * Display loader in widget status box
     */
    loader: function(on)
    {
        if (on) {
            var clone = cloneTemplate("#dash-template-loader");
            this.statusElement.html(clone);
        } else {
            this.statusElement.empty();
        }
    },

    /**
     * Return any matching child elements.
     */
    _child: function(sel)
    {
        return $(sel, this.element);
    }

}, /* class variables: */ {

    /** Mapping of type name of constructor. */
    _classes: {},

    /** Counter for widget instances to provide unique ID */
    counter: 0,

    /** Allowed keys in Widget.state */
    STATE_KEYS: ["id", "name", "overlay_id", "type", "color", "col", "pos",
        "height", "minimized", "refresh"],

    /** Minimum height for any widget. */
    MIN_HEIGHT: 100,

    /** Available colors, background -> foreground */
    COLORS: {
        'none':'',
        'gray':'white',
        'yellow': 'black',
        'red': 'black',
        'blue': 'white',
        'white': 'black',
        'orange': 'black',
        'green': 'black'},

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
 * Overlay class which handles the dashboard columnt layout.
 *
 * Provides two callbacks
 *
 * columnChangeCb - fired when columns change
 * widgetsMovedCb - fired when widget order has been changed
 *
 */
var Overlay = Base.extend({
    constructor: function(dashboard, columns)
    {
        this.columnChangeCb = new jQuery.Callbacks();
        this.widgetsMovedCb = new jQuery.Callbacks();
        this.dashboard = dashboard;
        this.element = $("table#overlay");
        this.setColumns(columns);
    },

    /**
     * Resets the overlay container table to original condition
     */
    destroy: function()
    {
        this.element.colResizable({disable:true});
        this._disableSortable();
        this._child("#overlay-top").empty();
        this._child("#overlay-columns").empty();
        this._child("#overlay-header").empty();
    },

    setColumns: function(columns)
    {
        // Reset
        this.destroy();

        // Re initialize
        this.columns = $.extend([], Overlay.DEFAULT_COLUMNS, columns);

        for (var i = 0; i < this.columns.length; i++) {
            this._createColumn(this.columns[i]);
        }
        this._enableSortable();
        this._resetResizable();
    },

    /**
     * Adds new column at the end
     */
    addColumn: function()
    {
        if (this.columns.length >= Overlay.MAX_COLUMNS) {
            alert("Maximum of " + Overlay.MAX_COLUMNS + " columns reached");
            return;
        }
        var width = Math.floor(100 / (this.columns.length + 1));
        var shrink = Math.floor(width / this.columns.length);
        var total = 0;
        this._child("#overlay-header th").each(function(){
            total += $(this).width();
        });
        this._child("#overlay-header th").each(function(){
            $(this).css("width", "-=" + Math.ceil(total * (shrink / 100)));
        });
        this._createColumn(width);
        this._updateColumnState();
        this._resetResizable();
        this._resetSortable();
    },

    /**
     * Removes the last column and moves the widgets to previous column
     */
    removeColumn:function()
    {
        if (this.columns.length <= 1) {
            alert("Cant remove the last column");
            return;
        }
        var toBeRemoved = this._child("#overlay-columns > td").last();
        var lastColumn = toBeRemoved.prev(".overlay-column");
        if (toBeRemoved.children().size()) {
            lastColumn.append(toBeRemoved.children());
            this.widgetsMovedCb.fire(this.columns.length - 1,
                    lastColumn.sortable("toArray"));
        }
        toBeRemoved.sortable("destroy").remove();
        this._child("#overlay-header > th").last().remove();
        var count = this._child("#overlay-columns > td").size();
        this._child("#overlay-top").attr("colspan", count);
        this._updateColumnState();
        this._resetResizable();
        this._resetSortable();
    },

    /**
     * Reset column widths to be even.
     */
    resetColumns: function()
    {
        var width = Math.floor(100 / this.columns.length);
        this._child("#overlay-header > th").css("width", width + "%");
        this._updateColumnState();
        this._resetResizable();
    },

    /**
     * Adds new widget in the overlay.
     * Inspects the widget.state.col/pos attributes and places it accordingly,
     * or as the first columns last, if col/pos does not match the overlay.
     */
    insertWidget: function(widget)
    {
        var col = widget.state.col;
        var colElement = this._child(".overlay-column").eq(col);
        if (!colElement.size()) {
            colElement = this._child("#overlay-columns > td").first();
            col = 1;
        }
        var posElement = colElement.find(".widget").eq(widget.state.pos);
        if (posElement.size()) {
            posElement.before(widget.element);
        } else {
            colElement.append(widget.element);
        }
        this.widgetsMovedCb.fire(col, colElement.sortable("toArray"));
        widget.reload();
        widget.onMaximizeCb.add($.proxy(this, "_onWidgetMaximize"));
        this._resetSortable();
    },

    /**
     * Disables and enables column resizing
     */
    _resetResizable: function()
    {
        this.element.colResizable({disable:true});
        this.element.colResizable({
            minWidth: Overlay.MIN_WIDTH,
            onResize: $.proxy(this, "_updateColumnState")
        });
    },

    /**
     * Disables and enables drag and drop sorting
     */
    _resetSortable: function()
    {
        this._disableSortable();
        this._enableSortable();
    },

    /**
     * Enables drag and drop sorting
     */
    _enableSortable: function()
    {
        this._child("td.overlay-column").sortable({
            connectWith: "td.overlay-column",
            handle: ".widget-header",
            opacity: 0.7,
            tolerance: "pointer",
            update: $.proxy(this, "_onSortUpdate"),
            start: $.proxy(this, "_onSortStart"),
            stop: $.proxy(this, "_onSortStop")
        });
    },

    /**
     * Disables drag and drop sorting
     */
    _disableSortable: function()
    {
        this._child("td.overlay-column").sortable("destroy");
    },

    /**
     * Creates a new column.
     * Separated from addColumn() so that the initial columns can be created
     * with single sortable/resizable reset
     */
    _createColumn: function(width)
    {
        var total = this.element.width();
        var index = this._child(".overlay-column").size()
        var newcolumn = $("<td id='column_" + index + "' />");
        newcolumn.addClass("overlay-column");
        this._child("#overlay-columns").append(newcolumn);
        var count = this._child("#overlay-columns > td").size();
        this._child("#overlay-top").attr("colspan", count);
        var header = $("<th><div class='resize-guide'/></th>");
        header.css("width", width + "%");
        this._child("#overlay-header").append(header);
    },

    /**
     * Calculates the column widths and stores them in state
     */
    _updateColumnState: function()
    {
        var total = 0;
        this._child("#overlay-columns > td").each(function(){
            total += $(this).width();
        });
        var columns = [];
        this._child("#overlay-columns > td").each(function(){
            columns.push(Math.floor($(this).width() / total * 100));
        });
        this.columns = columns;
        this.columnChangeCb.fire(this.columns);
    },

    /**
     * Event handlers for drag and drop sort
     */
    _onSortUpdate: function(event, ui) {
        var column = $(event.target)
        // TODO change the top column id to 'column_0'
        var col = Number(column.attr("id").split("_")[1] || 0);
        this.widgetsMovedCb.fire(col, column.sortable("toArray"));
    },
    _onSortStart: function() {
        this._child("td.overlay-column").addClass("overlay-column-hint");
    },
    _onSortStop: function() {
        this._child("td.overlay-column").removeClass("overlay-column-hint");
    },


    /**
     * Disables drag and drop sort when widget is maximized
     */
    _onWidgetMaximize: function(maximized)
    {
        if (maximized) {
            this._disableSortable();
        } else {
            this._enableSortable();
        }
    },

    /**
     * Return any matching child elements.
     */
    _child: function(sel)
    {
        return $(sel, this.element);
    }

}, /* Class variables */ {
    DEFAULT_COLUMNS: [100],
    MAX_COLUMNS: 4,
    MIN_WIDTH: 100
});


/**
 * Dashboard 'model': this maintains the front end's notion of the workspace
 * state, which includes column widths, widget instances, and other overlay
 * settings.
 *
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
        this.overlay = {};
        this._oldOverlay = null;
        this._unsavedChanges = false;
        this.widgets = {};
        this.buttons = {};
        this.config = config || {};

        this.initUI();
        if (this.config.overlay_id) {
            this.loadOverlay(config.overlay_id);
        } else {
            this.welcomeOverlay();
        }
        window.onbeforeunload = $.proxy(this, "_onBeforeUnload");
    },

    initUI: function()
    {
        var dashboard = this;
        $("#buttons button").each(function(){
            var $elem = $(this);
            var name = $elem.attr("name");
            dashboard.buttons[name] = $elem;
            $elem.button({
                text: false,
                icons: {primary: "icon-" + name.toLowerCase()}
            });
            var callback = "onClick" + name[0].toUpperCase() + name.slice(1);
            $elem.click($.proxy(dashboard, callback));
        });

        this.overlayInfo = $("#overlay-info");
        this.overlayInfo.find(".workspace,.unsaved,.shared,.pending").hide();
        this.widgetSelect = $("#buttons [name='widgettype']");
        this.overlaySettings = $("#overlay-settings");
        this.overlayList = $("#overlay-open");
        this.notifyBox = $("#dashboard_notify");
    },

    /******************
     * Button handlers.
     */
    onClickNewoverlay: function()
    {
        if (!this._confirmUnsaved()) return;
        this.setOverlay(this._makeDefaultOverlay());
        this._setUnsaved(false);
    },

    onClickAddwidget: function()
    {
        var type = this.widgetSelect.val();

        var widget = this._createWidget({
            name: 'Unnamed widget',
            type: type
        });
        widget.onClickEdit();
    },

    onClickSaveoverlay: function()
    {
        if (!this.overlay.id) {
            this._openOverlaySettings(true);
        } else {
            this.saveOverlay(false);
        }
    },

    onClickSaveoverlayas: function()
    {
        if (this.overlay.id) {
            this._oldOverlay = $.extend({}, this.overlay);
            if (this.overlay.id) {
                delete this.overlay.id;
                this.overlay.name = "Copy of " + this._oldOverlay.name;
            } else {
                this.overlay.name = "";
            }
            this.overlay.description = "";
            this.overlay.shared = false;
        }
        this._openOverlaySettings(true);
    },

    onClickOpenoverlay: function()
    {
        if (!this._confirmUnsaved()) return;
        this.rpc("overlay_list").done($.proxy(this, "_openOverlayList"));
    },

    onClickDeleteoverlay: function()
    {
        if(!confirm("Do you really want to delete this overlay")) return;
        var rpc = this.rpc('overlay_delete', {
            id: this.overlay.id
        });
        rpc.done($.proxy(this, "_onDeleteOverlayDone"));
    },
    _onDeleteOverlayDone: function()
    {
        this.notify("Overlay deleted");
        this._setUnsaved(false);
        this.onClickNewoverlay();
    },

    onClickPublishoverlay: function()
    {
        if (!this.overlay.user_can_publish) {
            alert("You are not allowed to publish this overlay!");
            return;
        }
        var rpc = this.rpc('overlay_publish', {
            id: this.overlay.id, withhold: 0
        });
        rpc.done($.proxy(this, "_onPublishOverlayDone"));

    },
    onClickWithholdoverlay: function()
    {
        if (!this.overlay.user_can_publish) {
            alert("You are not allowed to withhold this overlay!");
            return;
        }
        var rpc = this.rpc('overlay_publish', {
            id: this.overlay.id, withhold: 1
        });
        rpc.done($.proxy(this, "_onPublishOverlayDone"));

    },
    _onPublishOverlayDone: function(pending)
    {
        this.overlay.pending = pending;
        this.buttons.publishoverlay.toggle(pending);
        this.buttons.withholdoverlay.toggle(!pending);
        $(".pending", this.overlayInfo).toggle(this.overlay.shared && pending);
        if (pending) {
            this.notify("Overlay withheld");
        } else {
            this.notify("Overlay published");
        }
    },

    // TODO Overlay UI object should bind directly to these buttons
    onClickAddcolumn: function()
    {
        this.overlayUI.addColumn();
    },
    onClickRemovecolumn: function()
    {
        this.overlayUI.removeColumn();
    },
    onClickResetcolumns: function()
    {
        this.overlayUI.resetColumns();
    },

    onClickOverlaysettings: function()
    {
        this._openOverlaySettings(false);
    },

    /***********************************
     * Overlay settings dialog handling.
     */
    _openOverlaySettings: function(save)
    {
        var overlay = this.overlay;
        this.overlaySettings.find(".settings-field").each(function(){
            var field = $(this);
            var name = field.attr("name");
            if (field.attr("type") == "checkbox") {
                field.prop("checked", Boolean(overlay[name]));
            } else {
                field.val(overlay[name]);
            }
        });
        var buttons = {
            "Cancel": $.proxy(this, "_cancelOverlaySettings")
        };
        if (save) {
            buttons["Save"] = $.proxy(this, "_saveOverlaySettings");
        } else {
            buttons["Apply"] = $.proxy(this, "_applyOverlaySettings");
        }

        this.overlaySettings.dialog({
            modal: true,
            width: 500,
            zIndex: 9999,
            buttons: buttons
        });
    },
    _cancelOverlaySettings: function()
    {
        if (this._oldOverlay != null) this.overlay = this._oldOverlay;
        this.overlaySettings.dialog("close");
    },
    _applyOverlaySettings: function()
    {
        var overlay = this.overlay;
        var changed = false;
        this.overlaySettings.find(".settings-field").each(function(){
            var field = $(this);
            var name = field.attr("name");
            var value = null;
            if (field.attr("type") == "checkbox") {
                value = field.prop("checked");
            } else {
                value = field.val();
            }
            if (overlay[name] != value) {
                overlay[name] = value;
                changed = true;
            }
        });
        this.overlaySettings.dialog("close");
        if (changed) this._setUnsaved(true);
    },
    _saveOverlaySettings: function()
    {
        this._applyOverlaySettings();
        this.saveOverlay(true);
    },

    /**
     * Create initial empty overlay with welcome message
     */
    welcomeOverlay: function()
    {
        this.setOverlay($.extend(this._makeDefaultOverlay(),
        {
            columns: [25, 50, 25],
            widgets: [{
                col: 0,
                pos: 0,
                type: 'text',
                name: 'Welcome to Dashboard',
                height: 500,
                data :{text: $('#dash-template-welcome-text').html()}
            }]
        }));
        this._setUnsaved(false);
    },

    /**
     * Create an empty overlay definition
     */
    _makeDefaultOverlay: function()
    {
        return {
            name: 'New Overlay',
            description: '',
            workspace: false,
            shared: false,
            pending: true,
            user_can_edit: true,
            user_can_publish: false,
            columns: this._makeColumns(3),
            widgets: []
        };
    },

    /**
     * Saves the current overlay state
     */
    saveOverlay: function(asnew)
    {
        var rpc = this.rpc("overlay_save", this._makeSaveParams(asnew));
        rpc.done($.proxy(this, "_saveDone"));
        rpc.fail($.proxy(this, "_saveFail"));
    },

    _saveDone: function(result)
    {
        this.notify("Overlay saved");
        this._oldOverlay = null;
        this.setOverlay(result.overlay);
        this._setUnsaved(false);
    },
    _saveFail: function(error)
    {
        if(this._oldOverlay != null) this.overlay = this._oldOverlay;
    },

    _openOverlayList: function(overlays)
    {
        this.overlayList.find("ul").empty();
        this.overlayList.find(".pending-list").toggle(
            DASHBOARD_CONFIG.can_publish);
        this.overlayList.dialog({
            modal: true,
            width: 500,
            zIndex: 9999,
            position: {my: 'center top', at: 'center top'}
        });
        var list = this.overlayList.find("ul.shared");
        for (var i = 0; i < overlays.length; i++) {
            if (!overlays[i].shared || overlays[i].pending) continue;
            list.append(this._createOverlayEntry(overlays[i]));
        }
        var list = this.overlayList.find("ul.owner");
        list.empty();
        for (var i = 0; i < overlays.length; i++) {
            if (overlays[i].owner.id != this.config.user_id) continue;
            list.append(this._createOverlayEntry(overlays[i]));
        }
        if (DASHBOARD_CONFIG.can_publish) {
            list = this.overlayList.find("ul.pending");
            for (var i = 0; i < overlays.length; i++) {
                if (!overlays[i].pending) continue;
                list.append(this._createOverlayEntry(overlays[i]));
            }
        }
    },

    /**
     * Renders single overlay entry for the open dialog
     */
    _createOverlayEntry: function(overlay)
    {
        var elem = cloneTemplate("#template-overlay-entry");
        var openButton = $(".name", elem);
        openButton.html(overlay.name || "<i>-no name-</i>");
        openButton.button({
            icons:{primary:"ui-icon-folder-open"}
        }).click({id: overlay.id}, $.proxy(this, "_onClickLoad"));

        openButton.next().button({
            text: false,
            icons:{primary:"ui-icon-triangle-1-s"}
        }).click(function(){
            $(this).parent().next().slideToggle("fast");
        });

        openButton.parent().buttonset();

        // jQuery.show() does not seem to work for some reason...
        if (overlay.workspace) $("span.workspace", elem).css("display", "inline");
        if (overlay.shared) {
            $("span.shared", elem).css("display", "inline");
            if (overlay.pending) $("span.pending", elem).css("display", "inline");
        }
        $(".owner", elem).text(overlay.owner.name);
        $(".description", elem).text(overlay.description);
        $(".modified", elem).text(overlay.modified);
        return elem;
    },

    /**
     * Overlay clicked in the open dialog.
     */
    _onClickLoad: function(event, ui) {
        this.overlayList.dialog("close");
        this.loadOverlay(event.data.id);
    },

    /**
     * Loads overlay with given ID
     */
    loadOverlay: function(id)
    {
        this.rpc("overlay_get", {id: id}).done(
                $.proxy(this, "_loadDone"));
    },
    _loadDone: function(overlay) 
    {
        this.notify("Overlay loaded");
        this.setOverlay(overlay);
        this._setUnsaved(false);
    },

    /**
     * Reset front-end state to match the overlay described by the given
     * JSON object.
     *
     * @param workspace
     *      Overlay JSON, as represented by overlay_get RPC
     */
    setOverlay: function(overlay)
    {
        this.overlay = overlay;

        // Destroy old widgets
        for(var id in this.widgets) {
            this.widgets[id].destroy();
            delete this.widgets[id];
        }

        // Create overlay UI
        this.overlayUI = new Overlay(this, overlay.columns);
        this.overlayUI.columnChangeCb.add($.proxy(this, "_onColumnChange"));
        // Create new widgets
        overlay.widgets.sort(widgetPosCmp);
        while(overlay.widgets.length) {
            this._createWidget(overlay.widgets.shift());
        }
        this.overlayUI.widgetsMovedCb.add($.proxy(this, "_onWidgetsMoved"));

        // Set overlay info
        this.overlayInfo.attr("href",
                "page.cgi?id=dashboard.html&overlay_id=" + (overlay.id || ""))
        $(".name", this.overlayInfo).text(overlay.name);
        $(".workspace", this.overlayInfo).toggle(overlay.workspace);
        $(".shared", this.overlayInfo).toggle(overlay.shared);
        $(".pending", this.overlayInfo).toggle(overlay.shared && overlay.pending);

        // Set buttons
        this.buttons.saveoverlay.toggle(overlay.user_can_edit);
        this.buttons.deleteoverlay.toggle(overlay.id && overlay.user_can_edit);
        this.buttons.publishoverlay.toggle(overlay.user_can_publish && overlay.pending);
        this.buttons.withholdoverlay.toggle(overlay.user_can_publish && !overlay.pending);
    },

    /**
     * Creates a widget and inserts it in the overlay ui.
     */
    _createWidget: function(state)
    {
        var widget = Widget.createInstance(this, state);
        widget.onRemoveCb.add($.proxy(this, "_onWidgetRemove"));
        widget.stateChangeCb.add($.proxy(this, "_onWidgetStateChange"));
        this.widgets[widget.id] = widget;
        this.overlayUI.insertWidget(widget);
        return widget;
    },

    /*******************************************
     * Column and widget postion change handling.
     */
    _onWidgetsMoved: function(col, widget_ids)
    {
        for (var i = 0; i < widget_ids.length; i++) {
            var id = widget_ids[i].split("_")[1];
            this.widgets[id].updateState({col: col, pos: i});
        }
    },
    _onWidgetRemove: function(widget)
    {
        this._setUnsaved(true)
        delete this.widgets[widget.id]
    },
    _onColumnChange: function(columns)
    {
        this._setUnsaved(true);
        this.overlay.columns = columns;
    },
    _onWidgetStateChange: function(widget)
    {
        this._setUnsaved(true);
    },

    _setUnsaved: function(unsaved)
    {
        // If user can't edit the overlay, there won't be any changes that
        // could be saved
        if (!this.overlay.user_can_edit) unsaved = false;
        $(".unsaved", this.overlayInfo).toggle(unsaved);
        this._unsavedChanges = unsaved;

    },
    
    _confirmUnsaved: function()
    {
        if (this._unsavedChanges && this.overlay.user_can_edit) {
            return confirm("There are unsaved changes. Continue?");
        }
        return true;
    },

    _onBeforeUnload: function()
    {
        if (this._unsavedChanges) {
            return "There are unsaved changes, which would be lost.";
        }
    },

    /********************************************
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
        return rpc;
    },

    /**
     * Displays a notification in dashboard status box
     */
    notify: function(message)
    {
        this.notifyBox.text(message);
        this.notifyBox.stop(true, true).show()
            .delay(5000).fadeOut("slow");
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
        var width = Math.floor(100 / count);
        for(var i = 0; i < count; i++) {
            cols.push(width);
        }
        return cols;
    },

    /**
     * Return structure that can be saved through rpc
     *
     * @param asnew
     *      If true, removes the id values so that overlay gets saved as new one
     */
    _makeSaveParams: function(asnew)
    {
        var overlay = $.extend({}, this.overlay, {
            widgets: this._getWidgetStates(asnew)
        });
        if (asnew) delete overlay.id;
        return overlay;
    },
    /**
     * Return an array describing state of widgets in the workspace, as
     * understood by the save rpc methods
     */
    _getWidgetStates: function(asnew)
    {
        var states = [];
        for (var id in this.widgets) {
            var state = $.extend({}, this.widgets[id].state);
            if (asnew) delete state.id;
            states.push(state);
        }
        return states;
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
}

$(document).ready(main);
