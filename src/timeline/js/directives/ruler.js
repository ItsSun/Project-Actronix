/**
 * @file
 * @brief Ruler directives (dragging playhead functionality, progress bars, tick marks, etc...)
 * @author Jonathan Thomas <jonathan@openshot.org>
 * @author Cody Parker <cody@yourcodepro.com>
 *
 * @section LICENSE
 *
 * Copyright (c) 2008-2018 OpenShot Studios, LLC
 * <http://www.openshotstudios.com/>. This file is part of
 * OpenShot Video Editor, an open-source project dedicated to
 * delivering high quality video editing and animation solutions to the
 * world. For more information visit <http://www.openshot.org/>.
 *
 * OpenShot Video Editor is free software: you can redistribute it
 * and/or modify it under the terms of the GNU General Public License
 * as published by the Free Software Foundation, either version 3 of the
 * License, or (at your option) any later version.
 *
 * OpenShot Video Editor is distributed in the hope that it will be
 * useful, but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with OpenShot Library.  If not, see <http://www.gnu.org/licenses/>.
 */


// Variables for panning by middle click
var is_scrolling = false;
var starting_scrollbar = {x: 0, y: 0};
var starting_mouse_position = {x: 0, y: 0};

// Variables for scrolling control
var scroll_left_pixels = 0;


// This container allows for tracks to be scrolled (with synced ruler)
// and allows for panning of the timeline with the middle mouse button
/*global App, secondsToTime*/
App.directive("tlScrollableTracks", function () {
  return {
    restrict: "A",

    link: function (scope, element, attrs) {

      // Sync ruler to track scrolling
      element.on("scroll", function () {
        //set amount scrolled
        scroll_left_pixels = element.scrollLeft();

        $("#track_controls").scrollTop(element.scrollTop());
        $("#scrolling_ruler").scrollLeft(element.scrollLeft());
        $("#progress_container").scrollLeft(element.scrollLeft());

        if (scope.ignore_scroll == true) {
          // Reset flag and ignore scroll propagation
          scope.$apply( () => {
            scope.ignore_scroll = false;
            scope.scrollLeft = element[0].scrollLeft;
          })
          // exit at this point
          return;

        } else {
          // Only update scroll position
          scope.$apply( () => {
            scope.scrollLeft = element[0].scrollLeft;
          })
        }

        // Send scrollbar position to Qt
        if (scope.Qt) {
           // Calculate scrollbar positions (left and right edge of scrollbar)
           var timeline_length = Math.min(32767, scope.getTimelineWidth(0));
           var left_scrollbar_edge = scroll_left_pixels / timeline_length;
           var right_scrollbar_edge = (scroll_left_pixels + element.width()) / timeline_length;

           // Send normalized scrollbar positions to Qt
           timeline.ScrollbarChanged([left_scrollbar_edge, right_scrollbar_edge, timeline_length, element.width()]);
        }

      });

      // Initialize panning when middle mouse is clicked
      element.on("mousedown", function (e) {
        if (e.which === 2) { // middle button
          e.preventDefault();
          is_scrolling = true;
          starting_scrollbar = {x: element.scrollLeft(), y: element.scrollTop()};
          starting_mouse_position = {x: e.pageX, y: e.pageY};
          element.addClass("drag_cursor");
        }
      });

      // Pans the timeline (on middle mouse clip and drag)
      element.on("mousemove", function (e) {
        if (is_scrolling) {
          // Calculate difference from last position
          var difference = {x: starting_mouse_position.x - e.pageX, y: starting_mouse_position.y - e.pageY};

          // Scroll the tracks div
          element.scrollLeft(starting_scrollbar.x + difference.x);
          element.scrollTop(starting_scrollbar.y + difference.y);
        }
      });

      // Remove move cursor (i.e. dragging has stopped)
      element.on("mouseup", function (e) {
        element.removeClass("drag_cursor");
      });


    }
  };
});

// Track scrolling mode on body tag... allows for capture of released middle mouse button
App.directive("tlBody", function () {
  return {
    link: function (scope, element, attrs) {

      element.on("mouseup", function (e) {
        if (e.which === 2) { // middle button
          is_scrolling = false;
        }
      });


    }
  };
});


// The HTML5 canvas ruler
App.directive("tlRuler", function ($timeout) {
  return {
    restrict: "A",
    link: function (scope, element, attrs) {
      //on click of the ruler canvas, jump playhead to the clicked spot
      element.on("mousedown", function (e) {
        // Get playhead position
        var playhead_left = e.pageX - element.offset().left;
        var playhead_seconds = playhead_left / scope.pixelsPerSecond;

        // Immediately preview frame (don't wait for animated playhead)
        scope.previewFrame(playhead_seconds);

        // Animate to new position (and then update scope)
        scope.playhead_animating = true;
        $(".playhead-line").animate({left: playhead_left}, 200);
        $(".playhead-top").animate({left: playhead_left}, 200, function () {
          // Update playhead
          scope.movePlayhead(playhead_seconds);

          // Animation complete.
          scope.$apply(function () {
            scope.playhead_animating = false;
          });
        });

      });

      // Move playhead to new position (if it's not currently being animated)
      element.on("mousemove", function (e) {
        if (e.which === 1 && !scope.playhead_animating) { // left button
          var playhead_seconds = (e.pageX - element.offset().left) / scope.pixelsPerSecond;
          // Update playhead
          scope.movePlayhead(playhead_seconds);
          scope.previewFrame(playhead_seconds);
        }
      });

      //watch the scale value so it will be able to draw the ruler after changes,
      //otherwise the canvas is just reset to blank
      scope.$watch("project.scale + markers.length + project.duration", function (val) {
        if (val) {

          $timeout(function () {
            //get all scope variables we need for the ruler
            var scale = scope.project.scale;
            var tick_pixels = scope.project.tick_pixels;
            var each_tick = tick_pixels / 2;
            // Don't go over the max supported canvas size
            var pixel_length = Math.min(32767,scope.getTimelineWidth(1024));

            //draw the ruler
            var ctx = element[0].getContext("2d");
            //clear the canvas first
            ctx.clearRect(0, 0, element.width(), element.height());
            //set number of ticks based 2 for each pixel_length
            var num_ticks = pixel_length / 50;

            ctx.lineWidth = 1;
            ctx.strokeStyle = "#c8c8c8";
            ctx.lineCap = "round";

            //loop em and draw em
            for (var x = 0; x < num_ticks + 1; x++) {
              ctx.beginPath();

              //if it's even, make the line longer
              var line_top = 0;
              if (x % 2 === 0) {
                line_top = 18;
                //if it's not the first line, set the time text
                if (x !== 0) {
                  //get time for this tick
                  var time = (scale * x) / 2;
                  var time_text = secondsToTime(time, scope.project.fps.num, scope.project.fps.den);

                  //write time on the canvas, centered above long tick
                  ctx.fillStyle = "#c8c8c8";
                  ctx.font = "0.9em";
                  ctx.fillText(time_text["hour"] + ":" + time_text["min"] + ":" + time_text["sec"], x * each_tick - 22, 11);
                }
              } else {
                //shorter line
                line_top = 28;
              }

              ctx.moveTo(x * each_tick, 39);
              ctx.lineTo(x * each_tick, line_top);
              ctx.stroke();
            }
          }, 0);

        }
      });

    }

  };
});
