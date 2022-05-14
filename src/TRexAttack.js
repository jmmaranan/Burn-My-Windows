//////////////////////////////////////////////////////////////////////////////////////////
//          )                                                   (                       //
//       ( /(   (  (               )    (       (  (  (         )\ )    (  (            //
//       )\()) ))\ )(   (         (     )\ )    )\))( )\  (    (()/( (  )\))(  (        //
//      ((_)\ /((_|()\  )\ )      )\  '(()/(   ((_)()((_) )\ )  ((_)))\((_)()\ )\       //
//      | |(_|_))( ((_)_(_/(    _((_))  )(_))  _(()((_|_)_(_/(  _| |((_)(()((_|(_)      //
//      | '_ \ || | '_| ' \))  | '  \()| || |  \ V  V / | ' \)) _` / _ \ V  V (_-<      //
//      |_.__/\_,_|_| |_||_|   |_|_|_|  \_, |   \_/\_/|_|_||_|\__,_\___/\_/\_//__/      //
//                                 |__/                                                 //
//                       Copyright (c) 2021 Simon Schneegans                            //
//          Released under the GPLv3 or later. See LICENSE file for details.            //
//////////////////////////////////////////////////////////////////////////////////////////

'use strict';

const GObject = imports.gi.GObject;

const _ = imports.gettext.domain('burn-my-windows').gettext;

const ExtensionUtils = imports.misc.extensionUtils;
const Me             = imports.misc.extensionUtils.getCurrentExtension();
const utils          = Me.imports.src.utils;
const ShaderFactory  = Me.imports.src.ShaderFactory.ShaderFactory;

//////////////////////////////////////////////////////////////////////////////////////////
// This effect tears your windows apart with a series of violent scratches!             //
// This effect is not available on GNOME 3.3x, due to the limitation described in the   //
// documentation of vfunc_paint_target further down in this file.                       //
//////////////////////////////////////////////////////////////////////////////////////////

// The effect class can be used to get some metadata (like the effect's name or supported
// GNOME Shell versions), to initialize the respective page of the settings dialog, as
// well as to create the actual shader for the effect.
var TRexAttack = class TRexAttack {

  // The constructor creates a ShaderFactory which will be used by extension.js to create
  // shader instances for this effect. The shaders will be automagically created using the
  // GLSL file in resources/shaders/<nick>.glsl. The callback will be called for each
  // newly created shader instance.
  constructor() {
    this.shaderFactory = new ShaderFactory(this.getNick(), (shader) => {
      // We import these modules in this function as they are not available in the
      // preferences process. This callback is only called within GNOME Shell's process.
      const {Clutter, GdkPixbuf, Cogl} = imports.gi;

      // Create the texture in the first call.
      if (!this._clawTexture) {
        const clawData    = GdkPixbuf.Pixbuf.new_from_resource('/img/claws.png');
        this._clawTexture = new Clutter.Image();
        this._clawTexture.set_data(clawData.get_pixels(), Cogl.PixelFormat.RGB_888,
                                   clawData.width, clawData.height, clawData.rowstride);
      }

      // Store uniform locations of newly created shaders.
      shader._uClawTexture   = shader.get_uniform_location('uClawTexture');
      shader._uFlashColor    = shader.get_uniform_location('uFlashColor');
      shader._uSeed          = shader.get_uniform_location('uSeed');
      shader._uClawSize      = shader.get_uniform_location('uClawSize');
      shader._uNumClaws      = shader.get_uniform_location('uNumClaws');
      shader._uWarpIntensity = shader.get_uniform_location('uWarpIntensity');

      // Write all uniform values at the start of each animation.
      shader.connect('begin-animation', (shader, settings) => {
        const c = Clutter.Color.from_string(settings.get_string('claw-scratch-color'))[1];

        // If we are currently performing integration test, the animation uses a fixed
        // seed.
        const testMode = settings.get_boolean('test-mode');

        // clang-format off
        shader.set_uniform_float(shader._uFlashColor,    4, [c.red / 255, c.green / 255, c.blue / 255, c.alpha / 255]);
        shader.set_uniform_float(shader._uSeed,          2, [testMode ? 0 : Math.random(), testMode ? 0 : Math.random()]);
        shader.set_uniform_float(shader._uClawSize,      1, [settings.get_double('claw-scratch-scale')]);
        shader.set_uniform_float(shader._uNumClaws,      1, [settings.get_int('claw-scratch-count')]);
        shader.set_uniform_float(shader._uWarpIntensity, 1, [settings.get_double('claw-scratch-warp')]);
        // clang-format on
      });

      // This is required to bind the claw texture for drawing. Sadly, this seems to be
      // impossible under GNOME 3.3x as this.get_pipeline() is not available. It was
      // called get_target() back then but this is not wrapped in GJS.
      // https://gitlab.gnome.org/GNOME/mutter/-/blob/gnome-3-36/clutter/clutter/clutter-offscreen-effect.c#L598
      shader.connect('paint-target', (shader) => {
        const pipeline = shader.get_pipeline();

        // Use linear filtering for the window texture.
        pipeline.set_layer_filters(0, Cogl.PipelineFilter.LINEAR,
                                   Cogl.PipelineFilter.LINEAR);

        // Bind the claw texture.
        pipeline.set_layer_texture(1, this._clawTexture.get_texture());
        pipeline.set_uniform_1i(shader._uClawTexture, 1);
      });
    });
  }

  // ---------------------------------------------------------------------------- metadata

  // This effect is only available on GNOME Shell 40+.
  getMinShellVersion() {
    return [40, 0];
  }

  // This will be called in various places where a unique identifier for this effect is
  // required. It should match the prefix of the settings keys which store whether the
  // effect is enabled currently (e.g. '*-close-effect'), and its animation time
  // (e.g. '*-animation-time').
  getNick() {
    return 'trex';
  }

  // This will be shown in the sidebar of the preferences dialog as well as in the
  // drop-down menus where the user can choose the effect.
  getLabel() {
    return _('T-Rex Attack');
  }

  // -------------------------------------------------------------------- API for prefs.js

  // This is called by the preferences dialog. It loads the settings page for this effect,
  // and binds all properties to the settings.
  getPreferences(dialog) {

    // Add the settings page to the builder.
    dialog.getBuilder().add_from_resource('/ui/gtk4/TRexAttack.ui');

    // Bind all properties.
    dialog.bindAdjustment('trex-animation-time');
    dialog.bindColorButton('claw-scratch-color');
    dialog.bindAdjustment('claw-scratch-scale');
    dialog.bindAdjustment('claw-scratch-count');
    dialog.bindAdjustment('claw-scratch-warp');

    // Finally, return the new settings page.
    return dialog.getBuilder().get_object('trex-prefs');
  }

  // ---------------------------------------------------------------- API for extension.js

  // The getActorScale() is called from extension.js to adjust the actor's size during the
  // animation. This is useful if the effect requires drawing something beyond the usual
  // bounds of the actor. This only works for GNOME 3.38+.
  getActorScale(settings) {
    const scale = 1.0 + 0.5 * settings.get_double('claw-scratch-warp');
    return {x: scale, y: scale};
  }
}
