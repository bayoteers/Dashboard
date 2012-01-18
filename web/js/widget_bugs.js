
/**
 * Utility function to get form values as an object
 *
 * @param form The form element.
 * @return Object containing the name - value pairs
 *
 */
function getFormValues(form)
{
    var values = form.serializeArray();
    var result = {}
    for (var i = 0; i < values.length; i++){
        var entry = values[i];
        // Skip empty fields
        if(! entry.value) continue;
        if (entry.name in result){
            if (! $.isArray(result[entry.name])){
                result[entry.name] = [result[entry.name]];
            }
            result[entry.name].push($.trim(entry.value));
        }else{
            result[entry.name] = $.trim(entry.value);
        }
    }
    return result;
}

/**
 * Utility function to set values in a form
 *
 * Currently works only with forms consisting of normal input fields
 *
 * @param form
 *        The form element
 * @param data
 *        Object containing the values
 *
 */
function setFormValues(form, data)
{
    for (var key in data) {
        var elements = $("input[name='" + key + "']", form);
        if (elements.length == 0) continue;
        var values = data[key];
        if (! $.isArray(values)) values = [values];
        for (var i = 0; i < elements.length; i++){
            // set value in existing entries
            if (i < values.length) $(elements[i]).val(values[i]);
            // remove extra entries
            else if (i > values.length) $(elements[i]).remove();
            // empty the last entry
            else $(elements[i]).val("");
        }
        // Add more enties if more values (plus one empty)
        var last = elements.last();
        for (var i = elements.length; i < values.length; i++){
            // Clone and append after
            last = add_input(last);
            last.val(values[i]);
        }
    }
}
/**
 * Utility function to append new input entry
 *
 * @param element
 *        This element will be cloned and the new one is added after this one in
 *        the DOM.
 *
 */
function add_input(element)
{
    var clone = element.clone();
    clone.val("");
    element.after(clone);
    return clone;
}


/**
 * Generic bugs widget
 */
Widget.addClass('bugs', Widget.extend(
{
    // Default options
    // fields: Fields to show in bug result table
    DEFAULT_OPTIONS: {
        fields: ["id", "summary", "status"],
    },

    // See Widget.renderSettings().
    renderSettings: function()
    {
        this.base();
        this._params_form = this._child('form.search_params');
        this._options_form = this._child('form.table_options');

        $(".add_entry", this._params_form).click(function(event)
            {
                add_input($(event.target).prev("input"))
            });
        $(".add_entry", this._options_form).click(function(event)
            {
                add_input($(event.target).prev("input"))
            });
    },

    // See Widget.edit().
    edit: function(event)
    {
        this._restore();
        this._child('.edit').hide();
        this._child('.save').show();
        var editbox = this._child(".edit-box");
        // The element needs to be visible for colorbox to figure out the
        // dimensions.
        editbox.show()
        $.colorbox({
            inline: true,
            href: editbox,
            onClosed: this._onSaveClick.bind(this)
        });
    },

    // See Widget._restore().
    _restore: function()
    {
        this.base();
        var settings = {}
        if(this.state.text) settings = JSON.parse(this.state.text);
        this._params = settings.params ? settings.params : {};
        this._options = settings.options ? settings.options : this.DEFAULT_OPTIONS;
        setFormValues(this._params_form, this._params);
        setFormValues(this._options_form, this._options);
    },

    // See Widget._apply().
    _apply: function()
    {
        this.base();
        var params = getFormValues(this._params_form);
        var options = getFormValues(this._options_form);
        // Update the settings in state
        this.update({text: JSON.stringify(
                        {params: params, options: options})});
    }, 
    
    // See Widget.setState().
    setState: function(state)
    {
        this.base(state);
        var settings = {}
        if(state.text) settings = JSON.parse(state.text);
        this._params = settings.params ? settings.params : {};
        this._options = settings.options ? settings.options : this.DEFAULT_OPTIONS;
    },

    // See Widget.reload().
    reload: function()
    {
        this.innerElement.html(cloneTemplate('#loader_template'));
        var rpc = new Rpc('Bug', 'search', this._params);
        rpc.fail(this._onReloadFail.bind(this));
        rpc.done(this._onReloadDone.bind(this));
        //this._onResize();
    },
    
    /**
     * Display an error message when bug search fails
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
     * Create the bug list table
     *
     * @param result
     *      Result JSON object, as returned by search RPC.
     */
    _onReloadDone: function(result)
    {
        if (result.bugs.length == 0)
        {
            var content = $("<p>Sorry, no bugs found</p>");
        }
        else
        {
            var content = $("<table class='buglist tablesorter'/>");
            content.append("<thead/>");
            content.append("<tbody/>");
            // Create header
            var header = $("<tr/>");
            for (var i = 0; i < this._options.fields.length; i++)
            {
                header.append("<th>" + this._options.fields[i] + "</th>");
            }
            $("thead", content).append(header);
            // Format bug rows
            for(var i = 0; i < result.bugs.length; i++)
            {
                $("tbody", content).append(this._formatBug(result.bugs[i]));
            }
            content.tablesorter();
        }
        this.innerElement.html(content);
        this.innerElement.trigger('vertical_resize');
    },

    /**
     * Format bug as a single row in the table.
     *
     * @param bug
     *      Single Bug JSON object as returned by search RPC
     * @returns <tr> elemenet
     *
     */
    _formatBug: function(bug)
    {
        var row = $("<tr/>");
        for(var i = 0; i < this._options.fields.length; i++){
            var value = bug[this._options.fields[i]] ? bug[this._options.fields[i]] : "";
            row.append("<td>"+value+"</td>");
        }
        return row;
    }
}));

