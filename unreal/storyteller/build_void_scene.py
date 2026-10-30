"""
Build the "El in the Void with Mike" scene for the Storyteller project.

Run inside Unreal Editor 5.6+ (needs the Python Editor Script Plugin):
    Tools > Execute Python Script... > pick this file
or in the Output Log (Cmd):
    py "C:/path/to/build_void_scene.py"

What it makes (all under SCENE_FOLDER):
    L_TheVoid          new level: black void, mirror-still water floor,
                       overhead light beam through thin volumetric fog
    M_VoidWater        the floor material
    LS_ElInTheVoid     level sequence with a slow camera push-in,
                       El and Mike already bound so you can animate them

It never touches L_HawkinsRuin. If L_TheVoid already exists it stops,
so running it twice will not make duplicates.
"""

import re
import unreal

# ---------------------------------------------------------------------------
# Settings: change these to fit your project
# ---------------------------------------------------------------------------
SCENE_FOLDER = "/Game/Storyteller/TheVoid"
LEVEL_NAME = "L_TheVoid"
SEQUENCE_NAME = "LS_ElInTheVoid"

# Leave blank to auto-search /Game by name, or paste the asset path from
# the Content Browser (right click > Copy Reference), e.g.
# "/Game/Characters/Eleven/Eleven.Eleven"
ELEVEN_ASSET = ""
MIKE_ASSET = ""
ELEVEN_KEYWORDS = ["eleven", "el", "jane"]
MIKE_KEYWORDS = ["mike", "mikewheeler", "wheeler"]

SHOT_SECONDS = 8.0
FPS = 24
EXPOSURE_EV100 = 3.0  # raise if too bright, lower if too dark

# El faces Mike across a small gap, both standing in the water
ELEVEN_LOCATION = unreal.Vector(0.0, -90.0, 0.0)
MIKE_LOCATION = unreal.Vector(0.0, 90.0, 0.0)

# ---------------------------------------------------------------------------

assets = unreal.EditorAssetLibrary
actors = unreal.get_editor_subsystem(unreal.EditorActorSubsystem)
levels = unreal.get_editor_subsystem(unreal.LevelEditorSubsystem)
asset_tools = unreal.AssetToolsHelpers.get_asset_tools()
mel = unreal.MaterialEditingLibrary


def log(msg):
    unreal.log("[VoidScene] " + msg)


def warn(msg):
    unreal.log_warning("[VoidScene] " + msg)


def first_working(*calls):
    """Try API variants in order (names shift between engine versions)."""
    last_error = None
    for call in calls:
        try:
            return call()
        except Exception as e:  # noqa: BLE001
            last_error = e
    raise last_error


def set_props(obj, **props):
    for key, value in props.items():
        try:
            obj.set_editor_property(key, value)
        except Exception as e:  # noqa: BLE001
            warn("could not set {}.{}: {}".format(type(obj).__name__, key, e))


# ---------------------------------------------------------------------------
# Characters
# ---------------------------------------------------------------------------
def asset_class_name(path):
    data = assets.find_asset_data(path)
    try:
        return str(data.asset_class_path.asset_name)
    except Exception:  # noqa: BLE001
        return str(data.asset_class)


def find_character(explicit_path, keywords):
    if explicit_path:
        if assets.does_asset_exist(explicit_path):
            return assets.load_asset(explicit_path)
        warn("asset not found: " + explicit_path)
        return None

    matches = []
    for path in assets.list_assets("/Game", recursive=True, include_folder=False):
        name = path.rsplit("/", 1)[-1].split(".")[0]
        # split "CC_Eleven_v2" and "MikeWheeler" into word tokens
        words = re.sub(r"([a-z])([A-Z])", r"\1_\2", name).lower()
        tokens = set(re.split(r"[^a-z0-9]+", words)) | {name.lower()}
        if not tokens.intersection(keywords):
            continue
        cls = asset_class_name(path)
        if cls == "SkeletalMesh":
            matches.append((0, path))
        elif cls == "Blueprint":
            matches.append((1, path))

    if not matches:
        return None
    matches.sort()
    log("using {} for {}".format(matches[0][1], keywords[0]))
    return assets.load_asset(matches[0][1])


def spawn_character(asset, label, location, face_toward):
    if asset is None:
        warn("no asset for {}: set {}_ASSET at the top of the script".format(
            label, label.upper()))
        return None
    rot = unreal.MathLibrary.find_look_at_rotation(location, face_toward)
    rot = unreal.Rotator(0.0, 0.0, rot.yaw)  # stay upright, only turn
    # CC characters face +Y, so turn them -90 to look along the look-at
    rot.yaw -= 90.0
    actor = actors.spawn_actor_from_object(asset, location, rot)
    if actor:
        actor.set_actor_label(label)
    return actor


# ---------------------------------------------------------------------------
# Environment
# ---------------------------------------------------------------------------
def make_water_material():
    path = SCENE_FOLDER + "/M_VoidWater"
    if assets.does_asset_exist(path):
        return assets.load_asset(path)
    mat = asset_tools.create_asset("M_VoidWater", SCENE_FOLDER, unreal.Material,
                                   unreal.MaterialFactoryNew())

    def const(value, x, y, prop):
        node = mel.create_material_expression(
            mat, unreal.MaterialExpressionConstant, x, y)
        node.set_editor_property("r", value)
        mel.connect_material_property(node, "", prop)

    color = mel.create_material_expression(
        mat, unreal.MaterialExpressionConstant3Vector, -400, -200)
    color.set_editor_property("constant", unreal.LinearColor(0.002, 0.002, 0.004, 1.0))
    mel.connect_material_property(color, "", unreal.MaterialProperty.MP_BASE_COLOR)
    const(0.0, -400, 0, unreal.MaterialProperty.MP_METALLIC)
    const(1.0, -400, 100, unreal.MaterialProperty.MP_SPECULAR)
    const(0.03, -400, 200, unreal.MaterialProperty.MP_ROUGHNESS)

    mel.recompile_material(mat)
    assets.save_loaded_asset(mat)
    return mat


def build_environment():
    # Mirror floor: the engine plane is 1m, scale it to 500m
    plane = assets.load_asset("/Engine/BasicShapes/Plane")
    floor = actors.spawn_actor_from_object(plane, unreal.Vector(0, 0, 0))
    floor.set_actor_label("VoidWater")
    floor.set_actor_scale3d(unreal.Vector(500, 500, 1))
    floor.static_mesh_component.set_material(0, make_water_material())

    # Single cold light from above, the only thing lighting the void
    key = actors.spawn_actor_from_class(
        unreal.SpotLight, unreal.Vector(0, 0, 700), unreal.Rotator(0, -90, 0))
    key.set_actor_label("VoidKeyLight")
    c = key.spot_light_component
    set_props(c, intensity_units=unreal.LightUnits.LUMENS, intensity=3000.0,
              light_color=unreal.Color(r=215, g=225, b=255, a=255),
              outer_cone_angle=28.0, inner_cone_angle=10.0,
              attenuation_radius=2000.0, volumetric_scattering_intensity=3.0)

    # Faint rim behind the pair so they separate from the black
    rim = actors.spawn_actor_from_class(
        unreal.RectLight, unreal.Vector(400, 0, 250), unreal.Rotator(0, -20, 180))
    rim.set_actor_label("VoidRimLight")
    set_props(rim.rect_light_component, intensity_units=unreal.LightUnits.LUMENS,
              intensity=400.0, light_color=unreal.Color(r=150, g=170, b=255, a=255),
              source_width=300.0, source_height=150.0)

    # Thin fog so the key light reads as a beam, fading to black
    fog = actors.spawn_actor_from_class(
        unreal.ExponentialHeightFog, unreal.Vector(0, 0, 0))
    fog.set_actor_label("VoidFog")
    set_props(fog.component, fog_density=0.015, fog_height_falloff=0.5,
              fog_inscattering_luminance=unreal.LinearColor(0, 0, 0, 1),
              volumetric_fog=True, volumetric_fog_extinction_scale=1.5)

    # Locked exposure, so the dark stays dark instead of auto-brightening
    ppv = actors.spawn_actor_from_class(unreal.PostProcessVolume, unreal.Vector(0, 0, 0))
    ppv.set_actor_label("VoidPostProcess")
    ppv.set_editor_property("unbound", True)
    s = ppv.get_editor_property("settings")
    for name, value in [
        ("override_auto_exposure_min_brightness", True),
        ("auto_exposure_min_brightness", EXPOSURE_EV100),
        ("override_auto_exposure_max_brightness", True),
        ("auto_exposure_max_brightness", EXPOSURE_EV100),
        ("override_vignette_intensity", True),
        ("vignette_intensity", 0.6),
        ("override_bloom_intensity", True),
        ("bloom_intensity", 0.8),
        ("override_film_grain_intensity", True),
        ("film_grain_intensity", 0.15),
    ]:
        set_props(s, **{name: value})
    ppv.set_editor_property("settings", s)


# ---------------------------------------------------------------------------
# Camera and sequence
# ---------------------------------------------------------------------------
def build_sequence(eleven, mike):
    seq_path = SCENE_FOLDER + "/" + SEQUENCE_NAME
    if assets.does_asset_exist(seq_path):
        assets.delete_asset(seq_path)
    seq = asset_tools.create_asset(SEQUENCE_NAME, SCENE_FOLDER, unreal.LevelSequence,
                                   unreal.LevelSequenceFactoryNew())
    seq.set_display_rate(unreal.FrameRate(FPS, 1))
    end_frame = int(SHOT_SECONDS * FPS)
    seq.set_playback_start(0)
    seq.set_playback_end(end_frame)

    # Eye level between the two, slow push in from wide to a two-shot
    target = unreal.Vector(0, 0, 150)
    start = unreal.Vector(-650, -120, 160)
    finish = unreal.Vector(-320, -60, 155)

    cam = actors.spawn_actor_from_class(
        unreal.CineCameraActor, start,
        unreal.MathLibrary.find_look_at_rotation(start, target))
    cam.set_actor_label("VoidCam")
    cc = cam.get_cine_camera_component()
    set_props(cc, current_focal_length=35.0, current_aperture=2.0)
    focus = cc.get_editor_property("focus_settings")
    set_props(focus, focus_method=unreal.CameraFocusMethod.MANUAL,
              manual_focus_distance=(finish - target).length())
    cc.set_editor_property("focus_settings", focus)

    cam_binding = seq.add_possessable(cam)
    for actor in (eleven, mike):
        if actor:
            seq.add_possessable(actor)  # ready for you to add animation

    # Keyframe the camera move
    track = cam_binding.add_track(unreal.MovieScene3DTransformTrack)
    section = track.add_section()
    section.set_range(0, end_frame)
    channels = first_working(section.get_all_channels, section.get_channels)
    r0 = unreal.MathLibrary.find_look_at_rotation(start, target)
    r1 = unreal.MathLibrary.find_look_at_rotation(finish, target)
    keys = [
        (start.x, finish.x), (start.y, finish.y), (start.z, finish.z),
        (0.0, 0.0), (r0.pitch, r1.pitch), (r0.yaw, r1.yaw),
    ]
    for channel, (a, b) in zip(channels, keys):
        channel.add_key(unreal.FrameNumber(0), a)
        channel.add_key(unreal.FrameNumber(end_frame), b)

    # Camera cut so playback looks through VoidCam
    cut_track = first_working(
        lambda: seq.add_track(unreal.MovieSceneCameraCutTrack),
        lambda: seq.add_master_track(unreal.MovieSceneCameraCutTrack))
    cut = cut_track.add_section()
    cut.set_range(0, end_frame)
    binding_id = first_working(
        lambda: seq.get_portable_binding_id(seq, cam_binding),
        lambda: seq.make_binding_id(cam_binding, unreal.MovieSceneObjectBindingSpace.LOCAL),
        lambda: seq.get_binding_id(cam_binding))
    cut.set_camera_binding_id(binding_id)

    assets.save_loaded_asset(seq)
    return seq


# ---------------------------------------------------------------------------
def main():
    level_path = SCENE_FOLDER + "/" + LEVEL_NAME
    if assets.does_asset_exist(level_path):
        warn(level_path + " already exists. Delete or rename it to rebuild.")
        return

    if not levels.new_level(level_path):
        warn("could not create " + level_path)
        return

    build_environment()
    el = spawn_character(find_character(ELEVEN_ASSET, ELEVEN_KEYWORDS),
                         "Eleven", ELEVEN_LOCATION, MIKE_LOCATION)
    mike = spawn_character(find_character(MIKE_ASSET, MIKE_KEYWORDS),
                           "Mike", MIKE_LOCATION, ELEVEN_LOCATION)
    build_sequence(el, mike)

    levels.save_current_level()
    log("done. Open {}/{} and press play in Sequencer.".format(SCENE_FOLDER, SEQUENCE_NAME))


main()
