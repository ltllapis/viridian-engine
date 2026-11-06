"""3D spin of Vince's V logo coin for the end card.
Usage: python3 vlogo3d.py <logo.png> <out_dir> [frames=90] [only_frame]
Transparent PNG frames f001.png.. (720x720). Needs: pip install bpy==5.2.0 (Blender 5.2 as a Python module)."""
import bpy, math, os, sys, mathutils
logo, out = sys.argv[1], sys.argv[2]; N = int(sys.argv[3]) if len(sys.argv) > 3 else 90
only = int(sys.argv[4]) if len(sys.argv) > 4 else None
os.makedirs(out, exist_ok=True)
bpy.ops.wm.read_factory_settings(use_empty=True)
sc = bpy.context.scene
def mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True; return m, m.node_tree.nodes['Principled BSDF'], m.node_tree
# gold rim
rim_m, b, _ = mat('gold'); b.inputs['Base Color'].default_value = (.96, .72, .28, 1); b.inputs['Metallic'].default_value = 1; b.inputs['Roughness'].default_value = .22
bpy.ops.mesh.primitive_cylinder_add(vertices=128, radius=1.0, depth=.16); rim = bpy.context.object
bpy.ops.object.shade_smooth()
bv = rim.modifiers.new('bv', 'BEVEL'); bv.width = .055; bv.segments = 6
rim.data.materials.append(rim_m)
# logo faces
img = bpy.data.images.load(logo)
lm, lb, tree = mat('logo'); n = tree.nodes
tc = n.new('ShaderNodeTexCoord'); mp = n.new('ShaderNodeMapping'); tx = n.new('ShaderNodeTexImage'); tx.image = img; tx.extension = 'CLIP'
mp.inputs['Scale'].default_value = (1/1.86, 1/1.86, 1); mp.inputs['Location'].default_value = (.5, .5, 0)
tree.links.new(tc.outputs['Object'], mp.inputs['Vector']); tree.links.new(mp.outputs['Vector'], tx.inputs['Vector'])
tree.links.new(tx.outputs['Color'], lb.inputs['Base Color'])
lb.inputs['Roughness'].default_value = .38
try: lb.inputs['Coat Weight'].default_value = .25
except KeyError: pass
tree.links.new(tx.outputs['Color'], lb.inputs['Emission Color']); lb.inputs['Emission Strength'].default_value = .06
def disc(z, rot):
    bpy.ops.mesh.primitive_circle_add(vertices=128, radius=.93, fill_type='NGON', location=(0, 0, z), rotation=(0, rot, 0)); d = bpy.context.object
    d.data.materials.append(lm); return d
front = disc(.083, 0); back = disc(-.083, math.pi)
# group: coin parented to a spinner empty
spin = bpy.data.objects.new('spin', None); sc.collection.objects.link(spin)
for o in (rim, front, back):
    o.rotation_euler = (math.pi/2 + o.rotation_euler[0], o.rotation_euler[1], o.rotation_euler[2]) if False else o.rotation_euler
    o.parent = spin
# orient coin axis toward the camera (-Y): rotate the whole disc stack about X
coin = bpy.data.objects.new('coin', None); sc.collection.objects.link(coin); coin.rotation_euler = (math.pi/2, 0, 0)
spin.parent = coin if False else None
for o in (rim, front, back): o.parent = coin
coin.parent = spin
# animation
def key(obj, prop, idx, f, v, interp='BEZIER'):
    obj.keyframe_insert(prop, index=idx, frame=f)
    for fc in obj.animation_data.action.fcurves if hasattr(obj.animation_data.action, 'fcurves') else []:
        pass
sc.frame_start, sc.frame_end = 1, N
def setk(frame, rz, s, tilt):
    sc.frame_set(frame); spin.rotation_euler = (tilt, 0, rz); spin.scale = (s, s, s)
    spin.keyframe_insert('rotation_euler', frame=frame); spin.keyframe_insert('scale', frame=frame)
setk(1, 0, .35, 0); setk(int(N*.27), math.radians(560), 1.06, math.radians(-8)); setk(int(N*.42), math.radians(720), 1.0, math.radians(4))
setk(int(N*.7), math.radians(720+7), 1.0, math.radians(-3)); setk(N, math.radians(720), 1.0, 0)
# camera + light
bpy.ops.object.camera_add(location=(0, -4.9, 0), rotation=(math.pi/2, 0, 0)); cam = bpy.context.object; cam.data.lens = 70; sc.camera = cam
bpy.ops.object.light_add(type='AREA', location=(-3, -4, 3.5)); k = bpy.context.object; k.data.energy = 250; k.data.size = 4
k.rotation_euler = mathutils.Vector((3, 4, -3.5)).to_track_quat('-Z', 'Y').to_euler()
bpy.ops.object.light_add(type='AREA', location=(4, -3, -1.5)); f = bpy.context.object; f.data.energy = 85; f.data.size = 4
f.rotation_euler = mathutils.Vector((-4, 3, 1.5)).to_track_quat('-Z', 'Y').to_euler()
w = bpy.data.worlds.new('w'); w.use_nodes = True; w.node_tree.nodes['Background'].inputs['Color'].default_value = (.96, .93, .87, 1); w.node_tree.nodes['Background'].inputs['Strength'].default_value = .25; sc.world = w
sc.view_settings.view_transform = 'Standard'; sc.view_settings.look = 'None'
sc.render.engine = 'CYCLES'; sc.cycles.device = 'CPU'; sc.cycles.samples = 48; sc.cycles.use_denoising = True
sc.render.film_transparent = True; sc.render.resolution_x = 720; sc.render.resolution_y = 720
sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
frames = [only] if only else range(1, N + 1)
for fr in frames:
    sc.frame_set(fr); sc.render.filepath = os.path.join(out, 'f%03d.png' % fr); bpy.ops.render.render(write_still=True)
