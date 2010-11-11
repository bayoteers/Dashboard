/*
 * Based on example from NETTUTS.com [by James Padolsey]
 * and on example from jsabino.wordpress.com [by Mario Jimenez]
 *
 * @requires jQuery($), jQuery UI & sortable/draggable UI modules
 *
 * Contributor(s):
 *   Allan Savolainen <ext-jari.a.savolainen@nokia.com>
 */

var Dashboard_folder = 'extensions/Dashboard/web/';
var Dashboard = {
  jQuery : $,
  
  // Widget settings
  settings : {
    columns : '.column',
    widgetSelector: '.widget',
    handleSelector: '.widget-head',
    contentSelector: '.widget-content',
    widgetDefault : {
      movable: true,
      removable: true,
      collapsible: true,
      editable: true,
      resizable: true,
      resized: true,
      maximizable: true,
      refreshable: true,
      controls: true,
      width: 0,
      height: 256,
      refresh_id: 0,
      colorClasses : ['color-gray','color-yellow', 'color-red', 'color-blue', 'color-white', 'color-orange', 'color-green'],
      content: "<div align='center'><img class='loader' src='"+Dashboard_folder+"css/img/ajax-loader.gif'></div>"
    },
    widgetIndividual : {
      main : {
        movable: false,
        removable: false,
        collapsible: true,
        editable: false,
        maximizable: false,
        resizable: false,
        refreshable: false,
        controls: true
      }
    }
  },

  // Load stylesheet for widgets and initalize them
  init : function () {
    this.attachStylesheet(Dashboard_folder+'css/dashboard.js.css');
    
    this.makeSortable();
    this.addWidgetControls('main');
    $(".loader").each(function (i) {
      var id = $(this).parent().parent().parent().attr('id');
      $.post("page.cgi?id=dashboard_ajax.html",
        {
          "action" : 'load',
          "widget_id" : id.substring(6)
        },
        function(data){
          $("#"+id+" "+Dashboard.settings.contentSelector).html(data);
        }
      );
    });
  },
  
  getWidgetSettings : function (id) {
    var $ = this.jQuery,
      settings = this.settings;
    return (id&&settings.widgetIndividual[id]) ? $.extend({},settings.widgetDefault,settings.widgetIndividual[id]) : settings.widgetDefault;
  },
  
  // Populate widgets with control buttons
  addWidgetControls : function (id) {
    var Dashboard = this,
      $ = this.jQuery,
      settings = this.settings;
      
    $("#"+id).each(function () {
      var thisWidgetSettings = Dashboard.getWidgetSettings(this.id);
      
      
      
      if (thisWidgetSettings.removable) {
        $('<a href="#" class="remove">CLOSE</a>').mousedown(function (e) {
          e.stopPropagation();  
        }).click(function () {
          if(confirm('This widget will be removed, ok?')) {
            $(this).parents(settings.widgetSelector).animate({
              opacity: 0  
            },function () {
              $(this).wrap('<div/>').parent().slideUp(function () {
                $(this).remove();
                DeleteWidget(id);
              });
            });
          }
          return false;
        }).appendTo($(settings.handleSelector, this));
      }
      if (thisWidgetSettings.refreshable) {
        $('<a href="#" class="refresh">REFRESH</a>').mousedown(function (e) {
          e.stopPropagation();  
        }).click(function () {
          //if (window.frames[id+"_iframe"].location) window.frames[id+"_iframe"].location.reload();
          $('#'+id+'_iframe').attr("src",$("#"+id+"_iframe").attr("src"));
        }).appendTo($(settings.handleSelector, this));
      }
      if (thisWidgetSettings.resizable) {
        $(this).children(settings.contentSelector).resizable({
          handles: 's',
          grid: [50, 50],
          stop: function(event, ui) {
            $(this).css({width:''});
            thisWidgetSettings.resized=true;
            Dashboard.savePreferences(id);
          }
        });
      }
      
      if (thisWidgetSettings.editable) {
        $('<a href="#" class="edit">EDIT</a>').mousedown(function (e) {
          e.stopPropagation();  
        }).toggle(function () {
          $(this).addClass('save').removeClass('edit')
            .parents(settings.widgetSelector)
              .find('.edit-box').show().find('#'+id+'_title').focus();
          return false;
        },function () {
          $(this).addClass('edit').removeClass('save')
            .parents(settings.widgetSelector)
              .find('.edit-box').hide();
          Dashboard.savePreferences(id);
          return false;
        }).appendTo($(settings.handleSelector,this));
        
        $('<div class="edit-box" style="display:none;"/>')
          .append('<ul><li class="item"><label>Change the title?</label><input id="'+id+'_title" value="' + $('h3',this).text() + '"/></li>')
          .append((function(){
            var colorList = '<li class="item"><label>Available colors:</label><ul class="colors">';
            $(thisWidgetSettings.colorClasses).each(function () {
              colorList += '<li class="' + this + '"/>';
            });
            return colorList + '</ul>';
          })())
          .append('<li class="item"><label>URL:</label><input id="'+id+'_url" value=""></li>')
          .append('<li class="item"><label>Reload:</label><select id="'+id+'_refresh"><option value="0">no refresh</option><option value="15">every 15 seconds</option><option value="60">every minute</option><option value="300">every 5 minutes</option><option value="900">every 15 minutes</option><option value="1800">every 30 minutes</option></select>')
          .append('</ul>')
          .insertAfter($(settings.handleSelector,this));
      }
      
      if (thisWidgetSettings.collapsible) {
        $('<a href="#" class="collapse">COLLAPSE</a>').mousedown(function (e) {
          e.stopPropagation();  
        }).toggle(function () {
          $(this).parents(settings.widgetSelector).find(settings.contentSelector).hide();
          Dashboard.savePreferences(id);
          return false;
        },function () {
          $(this).parents(settings.widgetSelector).find(settings.contentSelector).show();
          Dashboard.savePreferences(id);
          return false;
        }).prependTo($(settings.handleSelector,this));
      }

      if (thisWidgetSettings.maximizable) {
        $('<a href="#" class="maximize">MAXIMIZE</a>').mousedown(function (e) {
          thisWidgetSettings.height = $(this).parents(settings.widgetSelector).children(settings.contentSelector).height();

          $(this).parents(settings.widgetSelector).children(settings.contentSelector).resizable("destroy");
          $(this).parents(settings.widgetSelector).children(settings.contentSelector).addClass('widget-max').prepend('<div id="maximized"><p>Press ESC or click here to return to the Dashboard</p></div>');
          $(this).parents(settings.widgetSelector).children(settings.contentSelector).css({'position':''});
          var widget = $(this).parent().parent().attr("id");
          $(".widget").each(function() {
            if ($(this).attr("id")!=widget) $(this).hide();
          });  
          
          var window_y = $(window).height()-10;
          //var widget_y = $(this).parents(settings.widgetSelector).children(settings.contentSelector).height();
          //$('.ui-resizable-handle').hide();
          $(this).parents(settings.widgetSelector).children(settings.contentSelector).height(window_y);
          $(window).trigger("resize");
          $('#maximized').click(function() {
            $(settings.contentSelector).removeClass('widget-max');
            $("#"+widget).children(settings.contentSelector).height(thisWidgetSettings.height);
            $('#maximized').remove();
            $("#"+widget).children(settings.contentSelector).resizable({
              handles: 's',
              grid: [50, 50],
              stop: function(event, ui) {
                $(this).css({width:''});
                thisWidgetSettings.resized=true;
                Dashboard.savePreferences(id);
              }
            });
            $(".widget").each(function() {
              $(this).show();
              
            });
            $(window).trigger("resize");
            //$('.ui-resizable-handle').show();
          });
          e.stopPropagation();  
        })
        /*
        .toggle(function () {
          $(this).parents(settings.widgetSelector).children(settings.contentSelector).addClass('widget-max').prepend('<div id="maximized"><p>Press ESC or click here to return to the Dashboard</p></div>');
          $(this).parents(settings.widgetSelector).children(settings.contentSelector).css({'position':''});
          $('#maximized').click(function() {
            $(settings.contentSelector).removeClass('widget-max');
            $('#maximized').remove();
          });
          alert('a');
          return false;
        },function () {
          $(this).parents(settings.widgetSelector).find(settings.contentSelector).show();
          alert('b');
          return false;
        })
        */.prependTo($(settings.handleSelector,this));
      }
    });
    
    $('.edit-box').each(function () {
      var thisWidgetSettings = Dashboard.getWidgetSettings(this.id);
      $('#'+id+'_url',this).keyup(function (e) {
        if(e.keyCode == 13) {
          eval(id+"_change_mode('url');");
        }
      });
      $('#'+id+'_title',this).keyup(function () {
        $(this).parents(settings.widgetSelector).find('h3').text( $(this).val().length>20 ? $(this).val().substr(0,20)+'...' : $(this).val() );
      });
      
      $('#'+id+'_refresh',this).change(function () {
        $("select option:selected").each(function () {
//          alert( thisWidgetSettings.refresh_id );
          if (thisWidgetSettings.refresh_id!=0) clearInterval(thisWidgetSettings.refresh_id);
          var refresh_timer = $('#'+id+'_refresh').val();
          if (refresh_timer>0)
          {
//          $('#'+id+'_iframe').attr("src",$("#"+id+"_iframe").attr("src"));
//          alert(id+'_refresh();');
            thisWidgetSettings.refresh_id = setInterval(id+'_refresh();',refresh_timer*1000);
          }
          else thisWidgetSettings.refresh_id = 0;
        });
      })
      .trigger('change');
      
      $('ul.colors li',this).click(function () {
        var colorStylePattern = /\bcolor-[\w]{1,}\b/,
          thisWidgetColorClass = $(this).parents(settings.widgetSelector).attr('class').match(colorStylePattern)
        if (thisWidgetColorClass) {
          $(this).parents(settings.widgetSelector)
            .removeClass(thisWidgetColorClass[0])
            .addClass($(this).attr('class').match(colorStylePattern)[0]);
        }
        return false;
      });
    });
  },
  
  attachStylesheet : function (href) {
    var $ = this.jQuery;
    return $('<link href="' + href + '" rel="stylesheet" type="text/css" />').appendTo('head');
  },
  
  makeSortable : function () {
    var Dashboard = this,
      $ = this.jQuery,
      settings = this.settings,
      $sortableItems = (function () {
        var notSortable = '';
        $(settings.widgetSelector,$(settings.columns)).each(function (i) {
          if (!Dashboard.getWidgetSettings(this.id).movable) {
            if(!this.id) {
              this.id = 'widget-no-id-' + i;
            }
            notSortable += '#' + this.id + ',';
          }
        });
        return $('> li:not(' + notSortable + ')', settings.columns);
      })();
    
    $sortableItems.find(settings.handleSelector).css({
      cursor: 'move'
    }).mousedown(function (e) {
      $sortableItems.css({width:''});
      $(this).parent().css({
        width: $(this).parent().width() + 'px'
      });
    }).mouseup(function () {
      if(!$(this).parent().hasClass('dragging')) {
        $(this).parent().css({width:''});
      } else {
        $(settings.columns).sortable('disable');
      }
    });

    $(settings.columns).sortable({
      items: $sortableItems,
      connectWith: $(settings.columns),
      handle: settings.handleSelector,
      placeholder: 'widget-placeholder',
      forcePlaceholderSize: true,
      revert: 300,
      delay: 100,
      opacity: 0.8,
      containment: 'document',
      start: function (e,ui) {
        $(ui.helper).addClass('dragging');
      },
      stop: function (e,ui) {
        $(ui.item).css({width:''}).removeClass('dragging');
        $(settings.columns).sortable('enable');
        SaveWidgets();
      }
    });
  },
  
  // Create new widget
  addWidget : function (where, opt) {
    //$("li").removeClass("new");
    //var selectorOld = Dashboard.settings.widgetSelector;
    //Dashboard.settings.widgetSelector = '.new';
    $(where).append(Dashboard.initWidget(opt));
    Dashboard.addWidgetControls(opt.id);
    //Dashboard.settings.widgetSelector = selectorOld;
    Dashboard.makeSortable();
    
    //$("li").removeClass("new");
    Dashboard.loadWidget(opt.id);
    
    Dashboard.savePreferences(opt.id);
    
  },
  
  initWidget : function (opt) {
    if (!opt.content) opt.content=Dashboard.settings.widgetDefault.content;
    return '<li id="'+opt.id+'" class="widget '+opt.color+'"><div class="widget-head"><h3>'+opt.title+'</h3></div><div class="widget-content">'+opt.content+'</div></li>';
  },
  
  loadWidget : function(id) {
//  alert('loadWidget');
    $.post("page.cgi?id=dashboard_ajax.html", 
      {
        "widget_id":id.substring(6),
        "action":'new',
        "widget_col":1,
        "widget_pos":99,
        "widget_height":256
      },
    function(data){
      $("#"+id+" "+Dashboard.settings.contentSelector+" img").parent().replaceWith(data);
//      $("#"+id+" "+Dashboard.settings.contentSelector).(data);
//      alert(data);
//      
//      $("#"+id+" "+Dashboard.settings.contentSelector).html('loaded');
    /*
      $("#"+id+" "+Dashboard.settings.contentSelector).html(data);
      $("#"+id+" "+Dashboard.settings.contentSelector).resizable({      
        handles: 's',
        stop:
        function(event, ui) {
          $(this).css({width:''});
          $(this).children().css({width:''});
        }
      });*/
    });  
  },
  
  // Store preferences to Bugzilla via POST
  savePreferences : function (id) {
    SaveWidget(id,$("#"+id).index(),$("#"+id).parent().attr('id').substring(6));
  },
  getSettings : function(id) {
    var Dashboard = this,
      $ = this.jQuery,
      settings = this.settings;
    
    var widget = [];
    
    $(settings.widgetSelector, $(settings.columns)).each(function () {
      if (id == this.id)
      {
        var thisWidgetSettings = Dashboard.getWidgetSettings(this.id);   
        widget['movable']=thisWidgetSettings.movable;
        widget['removable']=thisWidgetSettings.removable;
        widget['collapsible']=thisWidgetSettings.collapsible;
        widget['editable']=thisWidgetSettings.editable;
        widget['resizable']=thisWidgetSettings.resizable;
        widget['resized']=thisWidgetSettings.resized;
        widget['maximizable']=thisWidgetSettings.maximizable;
        widget['controls']=thisWidgetSettings.controls;
        widget['refreshable']=thisWidgetSettings.refreshable;
        widget['height']=$("#"+id+" "+settings.contentSelector).height();
        widget['color']=$("#"+id).attr('class').match(/\bcolor-[\w]{1,}\b/);
        widget['minimized']=$("#"+id+" "+settings.contentSelector).css('display') === 'none' ? 'true' : 'false';
        widget['title'] = $("#"+id+" "+settings.handleSelector+" h3").html();
        widget['widget_URL'] = $('#'+id+'_url').val();
        widget['widget_refresh']=$('#'+id+'_refresh').val();
      }
    });
    return widget;
  }
};

function AddWidget() {
  var i=1;
  while ($("#widget"+i).length>0) i++;
  Dashboard.addWidget("#column1", {
    id: "widget"+i,
    color: "color-gray",
    title: "Widget "+i
  });
}

function DeleteWidget(id) {
  $.post("page.cgi?id=dashboard_ajax.html",
    {
      'action' : 'delete',
      'widget_id' : id.substring(6)
    },
    function(result) {
    });
}

function SaveWidget(id,pos,col) {
  var widget = Dashboard.getSettings(id);
  var post = 'action=save';
  post += '&widget_id='+id.substring(6);
  post += '&widget_pos='+pos;
  post += '&widget_col='+col;
  for (var key in widget) {
    post += '&widget_'+key+'='+encodeURIComponent(widget[key]);
  }
  $.post("page.cgi?id=dashboard_ajax.html",
    post,
    function(result) {
      $(result).prependTo("#"+id+" .widget-content");
    });
}

function SaveWidgets() {
  for (var col=1; col<4; col++)
  {
    $("#column"+col).children().each(
      function(pos){
        var id = $(this).attr('id');
        if (id !='main'){
          SaveWidget(id,pos,col);
        }
      }
    );
  }
}

Dashboard.init();

$(window).trigger("resize");

$(document).keyup(function(e) {
  // clear possible maximized widgets when esc is pressed
  if (e.keyCode == 27) {

    //var y=$('#maximized').parent().height();
    //alert(y);
    //$('.widget-content').removeClass('widget-max');
    $('#maximized').each(function(index) {
      var id = $(this).parent().parent().attr("id");
      var thisWidgetSettings = Dashboard.getWidgetSettings(id);
            $('.widget-content').removeClass('widget-max');
            $("#"+id).children('.widget-content').height(thisWidgetSettings.height);
            $('#maximized').remove();
            $("#"+id).children('.widget-content').resizable({
              handles: 's',
              grid: [50, 50],
              stop: function(event, ui) {
                $(this).css({width:''});
                thisWidgetSettings.resized=true;
                Dashboard.savePreferences(id);
              }
            });
            $(".widget").each(function() {
              $(this).show();
            });
            $(window).trigger("resize");
    });
    //$('.ui-resizable-handle').show();
  }
});

