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
 * along with this program; if not, write to the Free Software
 * Foundation, Inc., 59 Temple Place - Suite 330, Boston, MA
 * 02111-1307, USA.
 *
 * The Sushi project hereby grant permission for non-gpl compatible GStreamer
 * plugins to be used and distributed together with GStreamer and Sushi. This
 * permission is above and beyond the permissions granted by the GPL license
 * Sushi is covered by.
 *
 * Authors: Cosimo Cecchi <cosimoc@redhat.com>
 *
 */

let MimeHandler = imports.ui.mimeHandler;
let Gst = imports.gi.Gst;
let Gio = imports.gi.Gio;

let Gettext = imports.gettext.domain("sushi");
let _ = Gettext.gettext;

let Constants = imports.util.constants;

let Utils = imports.ui.utils;

function AudioRenderer(args) {
    this._init(args);
}

AudioRenderer.prototype = {
    _init : function() {
        this.moveOnClick = true;
        this.canFullScreen = false;
    },

    prepare : function(file, mainWindow, callback) {
        this._mainWindow = mainWindow;
        this._file = file;
        this._callback = callback;

        this._createPlayer(file);

        this._box = new Gtk.Box({ orientation: Gtk.Orientation.HORIZONTAL,
                                  spacing: 6 });
        this._image = new Gtk.Image({ "icon-name": "media-optical-symbolic",
                                      "pixel-size": 256 });
        this._box.pack_start(this._image, false, false, 0);

        let vbox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL,
                                 spacing: 1,
                                 "margin-top": 48,
                                 "margin-left": 12,
                                 "margin-right": 12 });
        this._box.pack_start(vbox, false, false, 0);

        this._titleLabel = new Gtk.Label();
        this._titleLabel.set_halign(Gtk.Align.START);
        vbox.pack_start(this._titleLabel, false, false, 0);

        this._authorLabel = new Gtk.Label();
        this._authorLabel.set_halign(Gtk.Align.START);
        vbox.pack_start(this._authorLabel, false, false, 0);

        this._albumLabel = new Gtk.Label();
        this._albumLabel.set_halign(Gtk.Align.START);
        vbox.pack_start(this._albumLabel, false, false, 0);

        this._box.show_all();
        this._actor = new GtkClutter.Actor({ contents: this._box });

        this._callback();
    },

    render : function() {
        return this._actor;
    },

    _createPlayer : function(file) {
        this._player = new Sushi.SoundPlayer({ uri: file.get_uri() });
        this._player.playing = true;

        this._player.connect("notify::progress",
                             Lang.bind(this,
                                       this._onPlayerProgressChanged));
        this._player.connect("notify::duration",
                             Lang.bind(this,
                                       this._onPlayerDurationChanged));
        this._player.connect("notify::state",
                             Lang.bind(this,
                                       this._onPlayerStateChanged));
        this._player.connect("notify::taglist",
                             Lang.bind(this,
                                       this._onTagListChanged));
        this._player.connect("notify::cover",
                             Lang.bind(this,
                                       this._onCoverArtChanged));
    },

    clear : function(file) {
        this._player.playing = false;
        delete this._player;
    },

    _ensurePixbufSize : function(cover) {
        let width, height;

        width = cover.get_width();
        height = cover.get_height();

        if (width > 256 ||
            height > 256) {
            if (width > height) {
                this._coverArt = cover.scale_simple(256,
                                                    height * 256 / width,
                                                    GdkPixbuf.InterpType.BILINEAR);
            } else {
                this._coverArt = cover.scale_simple(width * 256 / height,
                                                    256,
                                                    GdkPixbuf.InterpType.BILINEAR);
            }
        } else {
            this._coverArt = cover;
        }
    },

    _onCoverArtChanged : function() {
        if (!this._artFetcher.cover) {
            this._image.set_from_icon_name("media-optical-symbolic");
            return;
        }

        this._ensurePixbufSize(this._artFetcher.cover);
        this._image.set_from_pixbuf(this._coverArt);
    },

    _onTagListChanged : function() {
        let tags = this._player.taglist;
        let albumName = tags.get_string("album")[1];
        let artistName = tags.get_string("artist")[1];
        let titleName = tags.get_string("title")[1];
        let haveTitleTag = true;

        if (!titleName) {
            let file = Gio.file_new_for_uri(this._player.uri);
            titleName = file.get_basename();
            haveTitleTag = false;
        }

        if (albumName)
            this._albumLabel.set_markup("<small><i>" + _("from") + "  </i>" + albumName + "</small>");
        if (artistName)
            this._authorLabel.set_markup("<small><i>" + _("by") + "  </i><b>" + artistName + "</b></small>");

        this._titleLabel.set_markup("<b>" + titleName + "</b>");

        let windowTitle = "";

        if (artistName && haveTitleTag)
            windowTitle = artistName + " - " + titleName;
        else
            windowTitle = titleName;

        this._mainWindow.setTitle(windowTitle);

        this._artFetcher = new Sushi.CoverArtFetcher();
        this._artFetcher.connect("notify::cover",
                                 Lang.bind(this, this._onCoverArtChanged));

        this._artFetcher.taglist = tags;

        this._mainWindow.refreshSize();
    },

    _updateProgressBar : function() {
        if (!this._mainToolbar)
            return;

        this._isSettingValue = true;
        this._progressBar.set_value(this._player.progress * 1000);
        this._isSettingValue = false;
    },

    _updateCurrentLabel : function() {
        if (!this._mainToolbar)
            return;

        let currentTime =
            Math.floor(this._player.duration * this._player.progress);

        this._currentLabel.set_text(Utils.formatTimeString(currentTime));
    },

    _updateDurationLabel : function() {
        if (!this._mainToolbar)
            return;

        let totalTime = this._player.duration;

        this._durationLabel.set_text(Utils.formatTimeString(totalTime));
    },

    _onPlayerProgressChanged : function() {
        this._updateProgressBar();
        this._updateCurrentLabel();
    },

    _onPlayerDurationChanged : function() {
        this._updateDurationLabel();
    },

    _onPlayerStateChanged : function() {
        switch(this._player.state) {
        case Sushi.SoundPlayerState.PLAYING:
            this._toolbarPlay.set_icon_name("media-playback-pause-symbolic");
            break;
        default:
            this._toolbarPlay.set_icon_name("media-playback-start-symbolic");
        }
    },

    getSizeForAllocation : function(allocation) {
        let width = this._box.get_preferred_width();
        let height = this._box.get_preferred_height();

        if (width[1] < Constants.VIEW_MIN &&
            height[1] < Constants.VIEW_MIN) {
            width[1] = Constants.VIEW_MIN;
        }

        /* return the natural */
        return [ width[1], height[1] ];
    },

    createToolbar : function () {
        this._mainToolbar = new Gtk.Toolbar();
        this._mainToolbar.get_style_context().add_class("np-toolbar");
        this._mainToolbar.set_icon_size(Gtk.IconSize.MENU);
        this._mainToolbar.show();

        this._toolbarActor = new GtkClutter.Actor({ contents: this._mainToolbar,
                                                    opacity: 0});
        this._toolbarActor.add_constraint(
            new Clutter.BindConstraint({ source: this._actor,
                                         coordinate: Clutter.BindCoordinate.WIDTH,
                                         offset: -50 }));

        this._toolbarPlay = new Gtk.ToolButton({ "icon-name": "media-playback-pause-symbolic" });
        this._toolbarPlay.show();
        this._mainToolbar.insert(this._toolbarPlay, 0);

        this._currentLabel = new Gtk.Label({ "margin-left": 6,
                                             "margin-right": 3 });
        let item = new Gtk.ToolItem();
        item.add(this._currentLabel);
        item.show_all();
        this._mainToolbar.insert(item, 1);

        this._toolbarPlay.connect("clicked",
                                  Lang.bind(this, function () {
                                      let playing = !this._player.playing;
                                      this._player.playing = playing;
                                  }));

        this._progressBar =
            Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL,
                                     0, 1000, 10);
        this._progressBar.set_value(0);
        this._progressBar.set_draw_value(false);
        this._progressBar.connect("value-changed",
                                  Lang.bind(this, function() {
                                      if(!this._isSettingValue)
                                          this._player.progress = this._progressBar.get_value() / 1000;
                                  }));

        let item = new Gtk.ToolItem();
        item.set_expand(true);
        item.add(this._progressBar);
        item.show_all();
        this._mainToolbar.insert(item, 2);

        this._durationLabel = new Gtk.Label({ "margin-left": 3 });
        let item = new Gtk.ToolItem();
        item.add(this._durationLabel);
        item.show_all();
        this._mainToolbar.insert(item, 3);

        return this._toolbarActor;
    },
}

let handler = new MimeHandler.MimeHandler();
let renderer = new AudioRenderer();

let audioTypes = [
    "audio/3gpp",
    "audio/ac3",
    "audio/AMR",
    "audio/AMR-WB",
    "audio/basic",
    "audio/flac",
    "audio/midi",
    "audio/mp2",
    "audio/mp4",
    "audio/mpeg",
    "audio/ogg",
    "audio/prs.sid",
    "audio/vnd.rn-realaudio",
    "audio/x-aiff",
    "audio/x-ape",
    "audio/x-flac",
    "audio/x-gsm",
    "audio/x-it",
    "audio/x-m4a",
    "audio/x-matroska",
    "audio/x-mod",
    "audio/x-mp3",
    "audio/x-mpeg",
    "audio/x-ms-asf",
    "audio/x-ms-asx",
    "audio/x-ms-wax",
    "audio/x-ms-wma",
    "audio/x-musepack",
    "audio/x-pn-aiff",
    "audio/x-pn-au",
    "audio/x-pn-wav",
    "audio/x-pn-windows-acm",
    "audio/x-realaudio",
    "audio/x-real-audio",
    "audio/x-sbc",
    "audio/x-speex",
    "audio/x-tta",
    "audio/x-wav",
    "audio/x-wavpack",
    "audio/x-vorbis",
    "audio/x-vorbis+ogg",
    "audio/x-xm",
];

handler.registerMimeTypes(audioTypes, renderer);
