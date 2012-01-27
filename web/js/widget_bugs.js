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
Widget.addClass('bugs', Widget.extend(
{
    // Default query string
    DEFAULT_QUERY: "",

    // See Widget.renderSettings().
    renderSettings: function()
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
        var loc = $("#cboxContent iframe").contents().get(0).location;
        if (loc.pathname.match("buglist.cgi")) {
            this._queryField.val(loc.search);
        }
    },

    /**
     * Confirm that query edit box is on buglist page before closing
     */
    _confirmQueryClose: function()
    {
        var page = $("#cboxContent iframe").contents()[0].location.pathname;
        if (page.match("buglist.cgi") == null) {
            return confirm(
                "After entering the search parameters, "
                + "you need to click 'search' to open "
                + "the buglist before closing. "
                + "Do you really want to close?");
        } else {
            return true;
        }
    },

    // See Widget._restore().
    _restore: function()
    {
        this.base();
        var settings = {}
        if (this.state.text) settings = JSON.parse(this.state.text);
        if (settings.query){
            this._query = settings.query;
            this._queryButton.data().colorbox.href = "buglist.cgi" + this._query;
        } else {
            this._query = this.DEFAULT_QUERY;
            this._queryButton.data().colorbox.href = "query.cgi";
        }
        this._queryField.val(this._query);
    },

    // See Widget._apply().
    _apply: function()
    {
        this.base();
        this.update({
            text: JSON.stringify({query: this._queryField.val()})
        });
    },

    // See Widget.setState().
    setState: function(state)
    {
        this.base(state);
        var settings = {}
        if (state.text) settings = JSON.parse(state.text);
        this._query = settings.query ?
            settings.query :
            this.DEFAULT_QUERY;
    },

    // See Widget.reload().
    reload: function()
    {
        if (this._query) {
            // display loader animation
            this.innerElement.html(cloneTemplate('#loader_template'));
            // set ctype to csv in query parameters
            params = getQueryParams(this._query);
            params.ctype = "csv";
            // Create request to fetch the data and set result callbacks
            var jqxhr = $.get("buglist.cgi" + getQueryString(params), {});
            jqxhr.success(this._onReloadDone.bind(this));
            jqxhr.error(this._onReloadFail.bind(this));
        } else {
            this.innerElement.html("Set the query string in widget options");
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
        this.innerElement.html("<p class='error'>" + error + "</p>");
    },

    /**
     * Create the bug list table
     *
     * @param result
     *      Result JSON object, as returned by search RPC.
     */
    _onReloadDone: function(data)
    {
        var buglist = $.csv()(data);
        if (buglist.length == 1) {
            var content = $("<p>Sorry, no bugs found</p>");
        } else {
            // Create table
            var content = $("<table class='buglist tablesorter'/>");
            content.append("<thead/>");
            content.append("<tbody/>");
            // Create header
            var header = $("<tr/>");
            for (var i = 0; i < buglist[0].length; i++)
            {
                header.append("<th>" + buglist[0][i] + "</th>");
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
            content.tablesorter();
        }
        this.innerElement.html(content);
        this.innerElement.trigger('vertical_resize');
    }

}));
