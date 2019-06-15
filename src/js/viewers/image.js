/*
 * Copyright (C) 2011 Red Hat, Inc.
 *
 * This program is free software; you can redistribute it and/or
 * modify it under the terms of the GNU General Public License as
 * published by the Free Software Foundation; either version 2 of the
 * License, or (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful, but
 * WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
 * General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program; if not, see <http://www.gnu.org/licenses/>.
 *
 * The Sushi project hereby grant permission for non-gpl compatible GStreamer
 * plugins to be used and distributed together with GStreamer and Sushi. This
 * permission is above and beyond the permissions granted by the GPL license
 * Sushi is covered by.
 *
 * Authors: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */
imports.gi.versions.Gdk = '3.0';
imports.gi.versions.Gtk = '3.0';

const Gdk = imports.gi.Gdk;
const GdkPixbuf = imports.gi.GdkPixbuf;
const GLib = imports.gi.GLib;
const GObject = imports.gi.GObject;
const Gtk = imports.gi.Gtk;

const Gettext = imports.gettext.domain('sushi');
const _ = Gettext.gettext;
const Lang = imports.lang;
const Mainloop = imports.mainloop;

const MimeHandler = imports.ui.mimeHandler;
const Utils = imports.ui.utils;

const Image = new Lang.Class({
    Name: 'Image',
    Extends: Gtk.DrawingArea,
    Properties: {
        'pix': GObject.ParamSpec.object('pix', '', '',
                                        GObject.ParamFlags.READWRITE,
                                        GdkPixbuf.Pixbuf)
    },

    _init: function() {
        this._pix = null;
        this._scaledSurface = null;

        this.parent();
    },

    _ensureScaledPix: function() {
        if (!this._pix)
            return;

        let scaleFactor = this.get_scale_factor();
        let width = this.get_allocated_width() * scaleFactor;
        let height = this.get_allocated_height() * scaleFactor;

        // Downscale original to fit, if necessary
        let origWidth = this._pix.get_width();
        let origHeight = this._pix.get_height();

        let scaleX = width / origWidth;
        let scaleY = height / origHeight;
        let scale = Math.min(scaleX, scaleY);

        let newWidth = Math.floor(origWidth * scale);
        let newHeight = Math.floor(origHeight * scale);

        let scaledWidth = this._scaledSurface ? this._scaledSurface.getWidth() : 0;
        let scaledHeight = this._scaledSurface ? this._scaledSurface.getHeight() : 0;

        if (newWidth != scaledWidth || newHeight != scaledHeight) {
            let scaledPixbuf = this._pix.scale_simple(newWidth, newHeight,
                                                      GdkPixbuf.InterpType.BILINEAR);
            this._scaledSurface = Gdk.cairo_surface_create_from_pixbuf(scaledPixbuf,
                                                                       scaleFactor,
                                                                       this.get_window());
        }
    },

    vfunc_get_preferred_width: function() {
        return [1, this._pix ? this._pix.get_width() : 1];
    },

    vfunc_get_preferred_height: function() {
        return [1, this._pix ? this._pix.get_height() : 1];
    },

    vfunc_size_allocate: function(allocation) {
        this.parent(allocation);
        this._ensureScaledPix();
    },

    vfunc_draw: function(context) {
        if (!this._scaledSurface)
            return false;

        let width = this.get_allocated_width();
        let height = this.get_allocated_height();

        let scaleFactor = this.get_scale_factor();
        let offsetX = (width - this._scaledSurface.getWidth() / scaleFactor) / 2;
        let offsetY = (height - this._scaledSurface.getHeight() / scaleFactor) / 2;

        context.setSourceSurface(this._scaledSurface, offsetX, offsetY);
        context.paint();
        return false;
    },

    set pix(p) {
        this._pix = p;
        this._scaledSurface = null;
        this.queue_resize();
    },

    get pix() {
        return this._pix;
    }
});

const ImageRenderer = new Lang.Class({
    Name: 'ImageRenderer',

    _init : function(args) {
        this._timeoutId = 0;
        this.moveOnClick = true;
        this.canFullScreen = true;
    },

    render : function(file, mainWindow) {
        this._mainWindow = mainWindow;
        this._file = file;

        this._createImageTexture(file);
        return this._texture;
    },

    _createImageTexture : function(file) {
        this._texture = new Image();

        file.read_async
        (GLib.PRIORITY_DEFAULT, null,
         Lang.bind(this,
                   function(obj, res) {
                       try {
                           let stream = obj.read_finish(res);
                           this._textureFromStream(stream);
                       } catch (e) {
                           logError(e, `Unable to read image file ${file.get_uri()}`);
                       }
                   }));
    },

    _textureFromStream : function(stream) {
        GdkPixbuf.PixbufAnimation.new_from_stream_async
        (stream, null,
         Lang.bind(this, function(obj, res) {
             let anim = GdkPixbuf.PixbufAnimation.new_from_stream_finish(res);

             this._iter = anim.get_iter(null);
             let pix = this._iter.get_pixbuf().apply_embedded_orientation();
             this._texture.pix = pix;

             if (!anim.is_static_image())
                 this._startTimeout();

             stream.close_async(GLib.PRIORITY_DEFAULT,
                                null, function(object, res) {
                                    try {
                                        object.close_finish(res);
                                    } catch (e) {
                                        logError(e, 'Unable to close the stream');
                                    }
                                });
         }));
    },

    getSizeForAllocation : function(allocation) {
        if (!this._texture.pix)
            return allocation;

        let width = this._texture.pix.get_width();
        let height = this._texture.pix.get_height();
        return Utils.getScaledSize([width, height], allocation, false);
    },

    _startTimeout : function() {
        this._timeoutId = Mainloop.timeout_add(this._iter.get_delay_time(),
                                               Lang.bind(this,
                                                         this._advanceImage));
    },

    populateToolbar : function(toolbar) {
        let toolbarZoom = Utils.createFullScreenButton(this._mainWindow);
        toolbar.insert(toolbarZoom, 0);
    },

    destroy : function () {
        /* We should do the check here because it is possible
         * that we never created a source if our image is
         * not animated. */
        if (this._timeoutId) {
            Mainloop.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    },

    _advanceImage : function () {
        this._iter.advance(null);
        let pix = this._iter.get_pixbuf().apply_embedded_orientation();
        this._texture.set_from_pixbuf(pix);
        return true;
    },
});

let handler = new MimeHandler.MimeHandler();

let formats = GdkPixbuf.Pixbuf.get_formats();
for (let idx in formats) {
    let mimeTypes = formats[idx].get_mime_types();
    handler.registerMimeTypes(mimeTypes, ImageRenderer);
}
