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

const {GLib, Sushi} = imports.gi;

const Lang = imports.lang;

const MimeHandler = imports.ui.mimeHandler;
const TotemMimeTypes = imports.util.totemMimeTypes;
const Utils = imports.ui.utils;

const GstRenderer = new Lang.Class({
    Name: 'GstRenderer',
    Extends: Sushi.MediaBin,

    _init : function(file, mainWindow) {
        this.parent({ uri: file.get_uri() });

        this.moveOnClick = true;
        // fullscreen is handled internally by the widget
        this.canFullScreen = false;

        this.connect('size-change', function() {
            mainWindow.refreshSize();
        });

        this._autoplayId = GLib.idle_add(0, () => {
            this._autoplayId = 0;
            this.play();
            return false;
        });

        this.connect('destroy', this._onDestroy.bind(this));
    },

    _onDestroy : function() {
        if (this._autoplayId > 0) {
            GLib.source_remove(this._autoplayId);
            this._autoplayId = 0;
        }
    },

    getSizeForAllocation : function(allocation) {
        let baseSize = [this.get_preferred_width()[1],
                        this.get_preferred_height()[1]];
        return Utils.getScaledSize(baseSize, allocation, true);
    }
});

let handler = new MimeHandler.MimeHandler();

handler.registerMimeTypes(TotemMimeTypes.videoTypes, GstRenderer);
