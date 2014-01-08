/**
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 *
 * Copyright (C) 2012 Jolla Ltd.
 * Contact: Pami Ketolainen <pami.ketolainen@jollamobile.com>
 *
 * The Initial Developer of the Original Code is "Nokia Corporation"
 * Portions created by the Initial Developer are Copyright (C) 2011 the
 * Initial Developer. All Rights Reserved.
 */


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
        if(this.state.data.selector) {
            var matched = $(this.state.data.selector, body);
            body.children().remove();
            matched.appendTo(body);
            matched.css('padding', '0px');
            body.css('margin', '0px');
        }
        body.find('a').attr('target', '_blank');
        $('html', this._iframe).css('margin', '0px');
    },

    onClickLoadurl: function()
    {
        var url = this.settingsDialog.find("[name='url']").val();
        if (url) {
            this._iframe.attr("src", url);
        }
    },

    reload: function()
    {
        var url = !url ? this.state.data.url : url;
        this._iframe.attr("src", this.state.data.url);
    }
}));


/**
 * RSS widget implementation.
 */
Widget.addClass('rss', Widget.extend({

    // See Widget.reload().
    reload: function()
    {
        this.loader(true);
        if(! this.state.data.url) {
            this.error('Please set a feed URL.');
            return;
        }
        var rpc = new Rpc('Dashboard', 'get_feed', { url: this.state.data.url });
        rpc.fail($.proxy(this, "error"));
        rpc.done($.proxy(this, "_onReloadDone"));
    },

    /**
     * Populate our template with the feed contents.
     *
     * @param feed
     *      Feed JSON object, as returned by get_feed RPC.
     */
    _onReloadDone: function(feed)
    {
        this.loader(false);
        var items = this.contentElement.find(".feed-items");
        items.empty();

        if(feed.link) {
            $('h2 a', this.contentElement).attr('href', feed.link);
        } else {
            $('h2 a', this.contentElement).attr('href', "");
        }
        $('h2 a', this.contentElement).text(feed.title);

        var length = Math.min(feed.items.length,
            DASHBOARD_CONFIG.rss_max_items);
        for(var i = 0; i < length; i++) {
            items.append(this._formatItem(feed.items[i]));
        }
    },

    /**
     * Format a single item.
     *
     * @param item
     *      Item JSON object as returned by get_feed RPC.
     */
    _formatItem: function(item)
    {
        var template = cloneTemplate('#rss-template-item');
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
    }
}));


/**
 * Text widget implementation.
 */
Widget.addClass('text', Widget.extend({
    reload: function()
    {
        this.contentElement.find("div.text").html(this.state.data.text);
    }
}));

/**
 * Confirmation support to colorbox.close()
 *
 * Adds new configuration option to colorbox
 *
 *      onCloseConfirm: callback
 *
 * Where callback is a function which should return true if it is ok to close
 * the box.
 */
$.colorbox.originalClose = $.colorbox.close;
$.colorbox.close = function() {
    element = $.colorbox.element();
    var confirmClose = element.data().colorbox.onCloseConfirm;
    if (typeof confirmClose == "undefined") {
        $.colorbox.originalClose();
    } else {
        if (confirmClose() == true) $.colorbox.originalClose();
    }
}

/**
 * Helper function to hide the header and footer from bugzilla page
 *
 * @param frame
 *      The iframe element
 */
function stripBugzillaPage(frame)
{
    var contents = $(frame).contents();
    contents.find("div#header").hide();
    contents.find("div#footer").hide();
}

/**
 * Generic bugs widget class
 */
var BugsWidget = Widget.extend(
{
    DEFAULT_COLUMNS: ["bug_id", "bug_status", "short_desc"],
    DEFAULT_SORT: [0, -1 , -1],

    // See Widget.render().
    render: function()
    {
        this.base();
        this._queryField = $("input[name='query']", this.settingsDialog);
        this._queryButton = $("input[name='editquery']", this.settingsDialog);
        this._queryButton.click($.proxy(this, '_openQueryEditor'));

        this._columnList = $("ul.buglist-column-select", this.settingsDialog);
        for (var name in BUGLIST_COLUMNS) {
            var item = $("<li/>");
            var check = $("<input type='checkbox'/>");
            check.attr("name", name);
            item.append(check).append(BUGLIST_COLUMNS[name]);
            item.append(cloneTemplate("#buglist-sort-template"));
            this._columnList.append(item);
        }
        this._columnList.sortable();
    },

    _sortOrder: function()
    {
        return $.isEmptyObject(this.state.data.sort) ?
                this.DEFAULT_SORT : this.state.data.sort;
    },
    _columnNames: function()
    {
        return $.isEmptyObject(this.state.data.columns) ?
                this.DEFAULT_COLUMNS : this.state.data.columns;
    },

    _setCustomSetting: function()
    {
        this.base();
        var columns = this._columnNames();
        var sort = this._sortOrder();

        // Iterate backwards so we can easily push the selected on top of the
        // list in right order
        for (var i = columns.length - 1; i >= 0; i--) {
            var check = this._columnList.find("input[name='" + columns[i] + "']");
            check.prop("checked", true);
            var item = check.parent();
            try {
                $("select", item).val(sort[i]);
            } catch(e) {
            }
            item.remove();
            this._columnList.prepend(item);
        }
    },

    _getCustomSettings: function()
    {
        var data = this.base();
        data.columns = [];
        data.sort = [];
        this._columnList.find("input:checked").each(function(){
            var check = $(this);
            data.columns.push(check.attr("name"));
            data.sort.push(Number(check.siblings("select").val()) || 0);
        });
        return data;
    },

    /**
     * See Widget._updateStateData()
     */
    _updateStateData: function(changes)
    {
        var changed = false;
        var changes = $.extend({}, changes);
        // columns and sort in data are arrays so they need special checking
        for (var key in {columns:1, sort:1}) {
            var list = changes[key];
            if(list == undefined) continue;
            delete changes[key];

            var orig = this.state.data[key] || [];
            if (list.length != orig.length) {
                this.state.data[key] = list;
                changed = true;
                continue;
            }

            for (var i = 0; i < list.length; i++) {
                if (list[i] != orig[i]) {
                    this.state.data[key] = list;
                    changed = true;
                    continue;
                }
            }
        }
        // Call the base implementation for remaining simple values
        return this.base(changes) || changed;
    },

    /**
     * Open query editor box when edit query button is clicked
     */
    _openQueryEditor: function()
    {
        $.colorbox({
            close: "Apply",
            width: "90%",
            height: "90%",
            iframe: true,
            fastIframe: false,
            href: "query.cgi" + this._queryField.val(),
            onCloseConfirm: $.proxy(this, '_confirmQueryClose'),
            onCleanup: $.proxy(this, '_getSearchQuery'),
            onComplete: $.proxy(this, '_onEditBoxReady')
        });
    },

    /**
     * Hide unneeded elements from the page in edit box
     */
    _onEditBoxReady: function()
    {
        var frame = $("#cboxContent iframe")
        stripBugzillaPage(frame);
        frame.load(function(event){stripBugzillaPage(event.target);});
    },

    /**
     * Get the query string from buglist page open in edit box
     */
    _getSearchQuery: function()
    {
        try {
            var loc = $("#cboxContent iframe").contents()[0].location;
            if (loc.pathname.match("buglist.cgi")) {
                this._queryField.val(loc.search);
            }
        } catch(e) {
            if (window.console) console.error(e);
            alert("Failed to get the query string");
        }
    },

    /**
     * Confirm that query edit box is on buglist page before closing
     */
    _confirmQueryClose: function()
    {
        var path = "";
        try {
            path = $("#cboxContent iframe").contents()[0].location.pathname;
        } catch(e) {
            if (window.console) console.error(e);
            return true;
        }
        if (path.match("buglist.cgi") == null) {
            return confirm(
                "After entering the search parameters, "
                + "you need to click 'search' to open "
                + "the buglist before closing. "
                + "Do you really want to close?");
        } else {
            return true;
        }
    },

    // See Widget.reload().
    reload: function()
    {
        this.loader(true);
        if (this.state.data.query) {
            // set ctype to csv in query parameters
            params = getQueryParams(this.state.data.query);
            params.ctype = "csv";

            // Set columns
            var columns = this._columnNames();
            if ($.isEmptyObject(columns)) columns = this.DEFAULT_COLUMNS;
            params.columnlist = columns.join(",");

            // Create request to fetch the data and set result callbacks
            var jqxhr = $.get("buglist.cgi" + getQueryString(params), {});
            jqxhr.success(this._onReloadDone.bind(this));
            jqxhr.error(this._onReloadFail.bind(this));
        } else {
            this.error("Set the query string in widget options");
        }
    },

    /**
     * Display an error message when bug list fetching
     *
     * @param error
     *      String error from backend.
     */
    _onReloadFail: function(error)
    {
        this.error(error);
    },

    /**
     * Create the bug list table
     *
     * @param result
     *      Result JSON object, as returned by search RPC.
     */
    _onReloadDone: function(data)
    {
        this.loader(false);
        try {
            var buglist = $.csv()(data);
        } catch(e) {
            this.error("Failed to parse bug list");
            return;
        }
        if (buglist.length == 1) {
            var content = $("<p>Sorry, no bugs found</p>");
        } else {
            var tableorder = [];
            var sort = this._sortOrder();
            var columns = this._columnNames();
            // Create table
            var content = $("<table class='buglist tablesorter'/>");
            content.append("<thead/>");
            content.append("<tbody/>");
            // Create header
            var header = $("<tr/>");
            for (var i = 0; i < buglist[0].length; i++)
            {
                var name = buglist[0][i];
                var index = columns.indexOf(name);
                if (sort[index] > -1) {
                    tableorder.push([i, sort[index]]);
                }
                header.append("<th>" + BUGLIST_COLUMNS[name] + "</th>");
            }
            $("thead", content).append(header);
            // Create rows
            for(var i = 1; i < buglist.length; i++)
            {
                var row = $("<tr/>");
                for(var j = 0; j < buglist[i].length; j++)
                {
                    var value = buglist[i][j];
                    var formatter = this["_format_" + buglist[0][j]];
                    if (formatter != undefined) {
                        value = formatter(value);
                    }
                    var cell = $("<td/>");
                    cell.append(value);
                    row.append(cell);
                }
                $("tbody", content).append(row);
            }
            // Make it pretty and sortable
            content.tablesorter({sortList: tableorder, useUI: true});
        }
        this.contentElement.html(content);
    },

    /**
     * Formatter for bug_id in data table
     */
    _format_bug_id: function(value)
    {
        var link = $("<a target='_blank'></a>");
        link.text(value);
        link.attr("href", "show_bug.cgi?id=" + value);
        return link;
    }
});
Widget.addClass('bugs', BugsWidget);

/**
 * My bugs widget implementation
 */
var MyBugsWidget = BugsWidget.extend({

    TEMPLATE_TYPE: "bugs",

    constructor: function(dashboard, state)
    {
        this.base(dashboard, state);
        // Exact same query as the default "My bugs" search
        this.state.data.query = getQueryString({
            bug_status: ['UNCONFIRMED', 'NEW', 'ASSIGNED', 'REOPENED'],
            email1: this._dashboard.config.user_login,
            emailassigned_to1: 1,
            emailreporter1: 1,
            emailtype1: 'exact',
            'field0-0-0': 'bug_status',
            'type0-0-0': 'notequals',
            'value0-0-0': 'UNCONFIRMED',
            'field0-0-1': 'reporter',
            'type0-0-1': 'equals',
            'value0-0-1': this._dashboard.config.user_login
        });
    },
    render: function()
    {
        this.base();
        this.settingsDialog.find(".buglist-query-entry").hide();
    }
});
Widget.addClass('mybugs', MyBugsWidget);
