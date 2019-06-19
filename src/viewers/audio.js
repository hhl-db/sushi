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

const {Gdk, GdkPixbuf, Gio, GLib, GObject, Gst, GstPbutils, GstTag, Gtk, Soup, Sushi} = imports.gi;

const Constants = imports.util.constants;
const Renderer = imports.ui.renderer;
const TotemMimeTypes = imports.util.totemMimeTypes;
const Utils = imports.ui.utils;

function _formatTimeString(timeVal) {
    let hours = Math.floor(timeVal / 3600);
    timeVal -= hours * 3600;

    let minutes = Math.floor(timeVal / 60);
    timeVal -= minutes * 60;

    let seconds = Math.floor(timeVal);

    let str = ('%02d:%02d').format(minutes, seconds);
    if (hours > 0) {
        str = ('%d').format(hours) + ':' + str;
    }

    return str;
}

const AMAZON_IMAGE_FORMAT = "http://images.amazon.com/images/P/%s.01.LZZZZZZZ.jpg";
const fetchCoverArt = function(_tagList, _callback) {
    function _fetchFromTags() {
        let coverSample = null;
        let idx = 0;

        while (true) {
            let [res, sample] = _tagList.get_sample_index(Gst.TAG_IMAGE, idx);
            if (!res)
                break;

            idx++;

            let caps = sample.get_caps();
            let capsStruct = caps.get_structure(0);
            let [r, type] = capsStruct.get_enum('image-type', GstTag.TagImageType.$gtype);
            if (type == GstTag.TagImageType.UNDEFINED) {
                coverSample = sample;
            } else if (type == GstTag.TagImageType.FRONT_COVER) {
                coverSample = sample;
                break;
            }
        }

        // Fallback to preview
        if (!coverSample)
            coverSample = _tagList.get_sample_index(Gst.TAG_PREVIEW_IMAGE, 0)[1];

        if (coverSample) {
            try {
                return Sushi.pixbuf_from_gst_sample(coverSample)
            } catch (e) {
                logError(e, 'Unable to fetch cover art from GstSample');
            }
        }
        return null;
    }

    function _getCacheFile(asin) {
        let cachePath = GLib.build_filenamev([GLib.get_user_cache_dir(), 'sushi']);
        return Gio.File.new_for_path(GLib.build_filenamev([cachePath, `${asin}.jpg`]));
    }

    function _fetchFromStream(stream, done) {
        GdkPixbuf.Pixbuf.new_from_stream_async(stream, null, (o, res) => {
            let cover;
            try {
                cover = GdkPixbuf.Pixbuf.new_from_stream_finish(res);
            } catch (e) {
                done(e, null);
                return;
            }

            done(null, cover);
        });
    }

    function _fetchFromCache(asin, done) {
        let file = _getCacheFile(asin);
        file.query_info_async(Gio.FILE_ATTRIBUTE_STANDARD_TYPE, 0, 0, null, (f, res) => {
            try {
                file.query_info_finish(res);
            } catch (e) {
                done(e, null);
                return;
            }

            file.read_async(0, null, (f, res) => {
                let stream;
                try {
                    stream = file.read_finish(res);
                } catch (e) {
                    done(e, null);
                    return;
                }

                _fetchFromStream(stream, done);
            });
        });
    }

    function _saveToCache(asin, stream, done) {
        let cacheFile = _getCacheFile(asin);
        let cachePath = cacheFile.get_parent().get_path();
        GLib.mkdir_with_parents(cachePath, 448);

        cacheFile.replace_async(null, false, Gio.FileCreateFlags.PRIVATE, 0, null, (f, res) => {
            let outStream;
            try {
                outStream = cacheFile.replace_finish(res);
            } catch (e) {
                done(e);
                return;
            }

            outStream.splice_async(
                stream,
                Gio.OutputStreamSpliceFlags.CLOSE_SOURCE |
                Gio.OutputStreamSpliceFlags.CLOSE_TARGET,
                0, null, (s, res) => {
                    try {
                        outStream.splice_finish(res);
                    } catch (e) {
                        done(e);
                        return;
                    }

                    done();
                });
        });
    }

    function _fetchFromAmazon(asin, done) {
        let uri = AMAZON_IMAGE_FORMAT.format(asin);
        let session = new Soup.Session();

        let request;
        try {
            request = session.request(uri);
        } catch (e) {
            done(e, null);
            return;
        }

        request.send_async(null, (r, res) => {
            let stream;
            try {
                stream = request.send_finish(res);
            } catch (e) {
                done(e, null);
                return;
            }

            _saveToCache(asin, stream, (err) => {
                if (err)
                    logError(err, 'Unable to save cover to cache');
                _fetchFromCache(asin, done);
            });
        });
    }

    function _fetchFromASIN(done) {
        let artist = _tagList.get_string('artist')[1];
        let album = _tagList.get_string('album')[1];

        Sushi.get_asin_for_track(artist, album, (o, res) => {
            let asin
            try {
                asin = Sushi.get_asin_for_track_finish(res);
            } catch (e) {
                done(e, null);
                return;
            }

            _fetchFromCache(asin, (err, cover) => {
                if (cover)
                    done(null, cover);
                else
                    _fetchFromAmazon(asin, done);
            });
        });
    }

   let cover = _fetchFromTags();
   if (cover) {
       _callback(null, cover);
       return;
   }

    _fetchFromASIN(_callback);
}

var Klass = GObject.registerClass({
    Implements: [Renderer.Renderer],
    Properties: {
        fullscreen: GObject.ParamSpec.boolean('fullscreen', '', '',
                                              GObject.ParamFlags.READABLE,
                                              false),
        ready: GObject.ParamSpec.boolean('ready', '', '',
                                         GObject.ParamFlags.READABLE,
                                         false)
    },
}, class AudioRenderer extends Gtk.Box {
    _init(file) {
        super._init({ orientation: Gtk.Orientation.HORIZONTAL,
                      spacing: 6 });

        this._discoverAudioTags(file);
        this._createPlayer(file);

        this._image = new Gtk.Image({ icon_name: 'media-optical-symbolic',
                                      pixel_size: 256 });
        this.pack_start(this._image, false, false, 0);

        let vbox = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL,
                                 spacing: 1,
                                 margin_top: 48,
                                 margin_start: 12,
                                 margin_end: 12 });
        this.pack_start(vbox, false, false, 0);

        this._titleLabel = new Gtk.Label();
        this._titleLabel.set_halign(Gtk.Align.START);
        vbox.pack_start(this._titleLabel, false, false, 0);

        this._authorLabel = new Gtk.Label();
        this._authorLabel.set_halign(Gtk.Align.START);
        vbox.pack_start(this._authorLabel, false, false, 0);

        this._albumLabel = new Gtk.Label();
        this._albumLabel.set_halign(Gtk.Align.START);
        vbox.pack_start(this._albumLabel, false, false, 0);

        this.connect('destroy', this._onDestroy.bind(this));
        this.isReady();
    }

    _discoverAudioTags(file) {
        this._discoverer = new GstPbutils.Discoverer();
        this._discoverer.connect('discovered', (d, info, err) => {
            if (err) {
                logError(err, `Unable to discover audio tags for ${file.get_uri()}`);
                return;
            }

            let tags = info.get_tags();
            if (tags)
                this._updateFromTags(tags);
        });
        this._discoverer.start();
        this._discoverer.discover_uri_async(file.get_uri());
    }

    _createPlayer(file) {
        this._playerNotifies = [];

        this._player = new Sushi.SoundPlayer({ uri: file.get_uri() });
        this._player.playing = true;

        this._playerNotifies.push(
            this._player.connect('notify::progress', this._onPlayerProgressChanged.bind(this)));
        this._playerNotifies.push(
            this._player.connect('notify::duration', this._onPlayerDurationChanged.bind(this)));
        this._playerNotifies.push(
            this._player.connect('notify::state', this._onPlayerStateChanged.bind(this)));
    }

    _onDestroy() {
        this._discoverer.stop();
        this._discoverer = null;

        this._playerNotifies.forEach((id) => this._player.disconnect(id));
        this._playerNotifies = [];
        this._player.playing = false;
        this._player = null;
    }

    _setCover(cover) {
        let scaleFactor = this.get_scale_factor();
        let size = 256 * scaleFactor;
        let width = cover.get_width();
        let height = cover.get_height();
        let targetWidth = size;
        let targetHeight = size;

        if (width > height)
            targetHeight = height * size / width;
        else
            targetWidth = width * size / height;

        let coverArt = cover.scale_simple(targetWidth, targetHeight,
                                          GdkPixbuf.InterpType.BILINEAR);
        let surface = Gdk.cairo_surface_create_from_pixbuf(coverArt, scaleFactor, this.get_window());
        this._image.set_from_surface(surface);
    }

    _onCoverArtFetched(err, cover) {
        if (err) {
            logError(err, 'Unable to fetch cover art');
            return;
        }

        this._setCover(cover);
    }

    _updateFromTags(tags) {
        let albumName = tags.get_string('album')[1];
        let artistName = tags.get_string('artist')[1];
        let titleName = tags.get_string('title')[1];

        if (!titleName) {
            let file = Gio.file_new_for_uri(this._player.uri);
            titleName = file.get_basename();
        }

        if (albumName)
            this._albumLabel.set_markup('<small><i>' + _("from") + '  </i>' + albumName + '</small>');
        if (artistName)
            this._authorLabel.set_markup('<small><i>' + _("by") + '  </i><b>' + artistName + '</b></small>');

        this._titleLabel.set_markup('<b>' + titleName + '</b>');

        if (artistName && albumName)
            fetchCoverArt(tags, this._onCoverArtFetched.bind(this));
    }

    _updateProgressBar() {
        if (!this._progressBar)
            return;

        this._isSettingValue = true;
        this._progressBar.set_value(this._player.progress * 1000);
        this._isSettingValue = false;
    }

    _updateCurrentLabel() {
        if (!this._currentLabel)
            return;

        let currentTime =
            Math.floor(this._player.duration * this._player.progress);

        this._currentLabel.set_text(_formatTimeString(currentTime));
    }

    _updateDurationLabel() {
        if (!this._durationLabel)
            return;

        let totalTime = this._player.duration;

        this._durationLabel.set_text(_formatTimeString(totalTime));
    }

    _onPlayerProgressChanged() {
        this._updateProgressBar();
        this._updateCurrentLabel();
    }

    _onPlayerDurationChanged() {
        this._updateDurationLabel();
    }

    _onPlayerStateChanged() {
        switch(this._player.state) {
        case Sushi.SoundPlayerState.PLAYING:
            this._toolbarPlay.image.set_from_icon_name('media-playback-pause-symbolic', Gtk.IconSize.MENU);
            break;
        default:
            let iconName = 'media-playback-start-symbolic';
            this._toolbarPlay.image.set_from_icon_name(iconName, Gtk.IconSize.MENU);
        }
    }

    get resizable() {
        return false;
    }

    get resizePolicy() {
        return Renderer.ResizePolicy.NAT_SIZE;
    }

    populateToolbar(toolbar) {
        this._toolbarPlay = Utils.createToolButton('media-playback-pause-symbolic', () => {
            let playing = !this._player.playing;
            this._player.playing = playing;
        });
        toolbar.add(this._toolbarPlay);

        this._currentLabel = new Gtk.Label({ margin_start: 6,
                                             margin_end: 3 });
        toolbar.add(this._currentLabel);

        this._progressBar =
            Gtk.Scale.new_with_range(Gtk.Orientation.HORIZONTAL,
                                     0, 1000, 10);
        this._progressBar.set_value(0);
        this._progressBar.set_draw_value(false);
        this._progressBar.connect('value-changed', () => {
            if(!this._isSettingValue)
                this._player.progress = this._progressBar.get_value() / 1000;
        });
        this._progressBar.set_size_request(200, -1);
        toolbar.add(this._progressBar);

        this._durationLabel = new Gtk.Label({ margin_start: 3 });
        toolbar.add(this._durationLabel);
    }
});

var mimeTypes = TotemMimeTypes.audioTypes;
