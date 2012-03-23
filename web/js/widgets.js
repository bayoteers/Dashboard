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

    onClickLoadurl: function()
    {
        var url = this.settingsDialog.find("[name='url']").val()
        this.reload(url);
    },

    reload: function(url)
    {
        var url = !url ? this.state.data.url : url;
        this._iframe.attr("src", url);
    },

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
    },
}));


/**
 * Text widget implementation.
 */
Widget.addClass('text', Widget.extend({
    reload: function()
    {
        this.contentElement.find("div.text").html(this.state.data.text);
    },
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
 * Utility function to covert query string to parameter object
 *
 * @param query
 *      String in format "key=value&key=othervalue&foo=bar"
 *
 * @returns Object containing the paramters
 *      {key: ["value", "othervalue"], foo: "bar"}
 *      Values will be URI decoded
 */
function getQueryParams(query)
{
    var params = {};
    var regex = /([^=&\?]*)=([^&]*)/g;
    var match = null;
    while ((match = regex.exec(query)) != null) {
        var name = match[1];
        var value = decodeURIComponent(match[2]);
        if (params.hasOwnProperty(name)) {
            if (! $.isArray(params[name])) {
                params[name] = [params[name]];
            }
            params[name].push(value);
        } else {
            params[name] = value;
        }
    }
    return params;
}
/**
 * Utility function to convert parameter object ro query string
 *
 * @param params
 *      Object containing teh params
 *      { key: ["value", "othervalue"], foo: "bar" }
 *
 * @returns Query string
 *      "?key=value&key=othervalue&foo=bar"
 *      Values will be URI encoded
 */
function getQueryString(params)
{
    var query = "?"
    for (name in params) {
        var values = params[name];
        if (! $.isArray(values)) values = [values];
        for (var i = 0; i < values.length; i++) {
            query += "&" + name + "=" + encodeURIComponent(values[i]);
        }
    }
    return query;
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
        this._queryField = this._child("input[name='query']");
        this._queryButton = this._child("input[name='editquery']");
        this._queryButton.colorbox({
            width: "90%",
            height: "90%",
            iframe: true,
            fastIframe: false,
            href: "query.cgi",
            onCloseConfirm: this._confirmQueryClose.bind(this),
            onCleanup: this._getSearchQuery.bind(this),
            onComplete: this._onEditBoxReady.bind(this)
        });
        this._columnList = this._child("ul.buglist-column-select");
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

    _setCustomSettingFields: function()
    {
        this.base();
        var columns = this._columnNames();
        var sort = this._sortOrder();

        for (var i = columns.length - 1; i >= 0; i--) {
            var check = this._columnList.find("[name='" + columns[i] + "']");
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

    _applyCustomSettings: function()
    {
        this.base();
        var columns = [];
        var sort = [];
        this._columnList.find(":checked").each(function(){
            var check = $(this);
            columns.push(check.attr("name"));
            sort.push(Number(check.siblings("select").val()) || 0);
        });
        this.state.data.columns = columns;
        this.state.data.sort = sort;
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
                    row.append("<td>" + buglist[i][j]+"</td>");
                }
                $("tbody", content).append(row);
            }
            // Make it pretty and sortable
            content.tablesorter({sortList:tableorder});
        }
        this.contentElement.html(content);
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
            'value0-0-1': this._dashboard.config.user_login,
        });
    },
    render: function()
    {
        this.base();
        this.settingsDialog.find(".buglist-query-entry").hide();
    },
});
Widget.addClass('mybugs', MyBugsWidget);
