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
      resizable: false,
      maximizable: true,
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
        resizable: false
      }
    }
  },

  // Load stylesheet for widgets and initalize them
  init : function () {
    this.attachStylesheet(Dashboard_folder+'css/dashboard.js.css');
    this.addWidgetControls();
    this.makeSortable();
  },
  
  getWidgetSettings : function (id) {
    var $ = this.jQuery,
      settings = this.settings;
    return (id&&settings.widgetIndividual[id]) ? $.extend({},settings.widgetDefault,settings.widgetIndividual[id]) : settings.widgetDefault;
  },
  
  // Populate widgets with control buttons
  addWidgetControls : function () {
    var Dashboard = this,
      $ = this.jQuery,
      settings = this.settings;
      
    $(settings.widgetSelector, $(settings.columns)).each(function () {
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
              });
            });
          }
          return false;
        }).appendTo($(settings.handleSelector, this));
      }
      
      if (thisWidgetSettings.resizable) {
        $(this).children(settings.contentSelector).resizable({
          handles: 's',
          stop: function(event, ui) { $(this).css({width:''}); }
        });
      }
      
      if (thisWidgetSettings.editable) {
        $('<a href="#" class="edit">EDIT</a>').mousedown(function (e) {
          e.stopPropagation();  
        }).toggle(function () {
          $(this).css({"background-image": 'url('+Dashboard_folder+'css/img/save.png)'})
            .parents(settings.widgetSelector)
              .find('.edit-box').show().find('input').focus();
          return false;
        },function () {
          $(this).css({"background-image": 'url('+Dashboard_folder+'css/img/prefs.png)'})
            .parents(settings.widgetSelector)
              .find('.edit-box').hide();
          return false;
        }).appendTo($(settings.handleSelector,this));
        $('<div class="edit-box" style="display:none;"/>')
          .append('<ul><li class="item"><label>Change the title?</label><input value="' + $('h3',this).text() + '"/></li>')
          .append((function(){
            var colorList = '<li class="item"><label>Available colors:</label><ul class="colors">';
            $(thisWidgetSettings.colorClasses).each(function () {
              colorList += '<li class="' + this + '"/>';
            });
            return colorList + '</ul>';
          })())
          .append('</ul>')
          .insertAfter($(settings.handleSelector,this));
      }
      
      if (thisWidgetSettings.collapsible) {
        $('<a href="#" class="collapse">COLLAPSE</a>').mousedown(function (e) {
          e.stopPropagation();  
        }).toggle(function () {
          $(this).parents(settings.widgetSelector).find(settings.contentSelector).hide();
          return false;
        },function () {
          $(this).parents(settings.widgetSelector).find(settings.contentSelector).show();
          return false;
        }).prependTo($(settings.handleSelector,this));
      }

      if (thisWidgetSettings.maximizable) {
        $('<a href="#" class="maximize">MAXIMIZE</a>').mousedown(function (e) {
          e.stopPropagation();  
        }).toggle(function () {
          $(this).parents(settings.widgetSelector).children(settings.contentSelector).addClass('widget-max').prepend('<div id="maximized"><p>Press ESC or click here to return to the Dashboard</p></div>');
          $(this).parents(settings.widgetSelector).children(settings.contentSelector).css({'position':''});
          $('#maximized').click(function() {
            $(settings.contentSelector).removeClass('widget-max');
            $('#maximized').remove();
          });
          return false;
        },function () {
          $(this).parents(settings.widgetSelector).find(settings.contentSelector).show();
          return false;
        }).prependTo($(settings.handleSelector,this));
      }
    });
    
    $('.edit-box').each(function () {
      $('input',this).keyup(function () {
        $(this).parents(settings.widgetSelector).find('h3').text( $(this).val().length>20 ? $(this).val().substr(0,20)+'...' : $(this).val() );
      });
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
      }
    });
  },
  
  // Create new widget
  addWidget : function (where, opt) {
    $("li").removeClass("new");
    var selectorOld = Dashboard.settings.widgetSelector;
    Dashboard.settings.widgetSelector = '.new';
    $(where).append(Dashboard.initWidget(opt));
    Dashboard.addWidgetControls();
    Dashboard.settings.widgetSelector = selectorOld;
    Dashboard.makeSortable();
    Dashboard.loadWidget(opt.id);
    Dashboard.savePreferences(opt.id,'grid');
  },
  
  initWidget : function (opt) {
    if (!opt.content) opt.content=Dashboard.settings.widgetDefault.content;
    return '<li id="'+opt.id+'" class="new widget '+opt.color+'"><div class="widget-head"><h3>'+opt.title+'</h3></div><div class="widget-content">'+opt.content+'</div></li>';
  },
  
  loadWidget : function(id) {
    $.post("page.cgi?id=dashboard_ajax.html", {"widget":id},
    function(data){
      $("#"+id+" "+Dashboard.settings.contentSelector).html(data);
      $("#"+id+" "+Dashboard.settings.contentSelector).resizable({      
        handles: 's',
        stop:
        function(event, ui) {
          $(this).css({width:''});
          $(this).children().css({width:''});
        }
      });
    });  
  },
  
  // Store preferences to Bugzilla via POST
  savePreferences : function (id,type) {
//    alert('save '+id+':'+type);
  }
};

function AddWidget() {
  var i=1;
  while ($("#widget"+i).length>0) i++;
  Dashboard.addWidget("#column1", {
    id: "widget"+i,
    color: "color-blue",
    title: "widget "+i
  })
}

function SaveWidgets() {
  for (var col=1; col<4; col++)
  {
    $("#column"+col).children().each(
      function( intIndex ){
        var id = $(this).attr('id');
        if (id !='main'){
          $("#"+id).css({'border':'4px solid red'});
          $.post("page.cgi?id=dashboard_ajax.html",
          {
            "action" : 'save',
            "widget_id" : id.substring(6),
            "widget_pos" : intIndex,
            "widget_col" : col
          }, function(result) {
            $("#"+id).html(result);
            //alert(result);
          });
          $("#"+id).css({'border':''});
        }
      }
    );
  }
}

Dashboard.init();

$(document).keyup(function(e) {
  // clear possible maximized widgets when esc is pressed
  if (e.keyCode == 27) {
    $('.widget-content').removeClass('widget-max');
    $('#maximized').remove();
  }
});
