#version 120

uniform sampler2D texture;
uniform sampler2D lightmap;
uniform vec3 sunPosition;
uniform float frameTimeCounter;

varying vec2 texcoord;
varying vec4 lmcoord;
varying vec4 color;

void main() {
    vec4 albedo = texture2D(texture, texcoord);
    vec4 light = texture2D(lightmap, lmcoord.xy);
    float wobble = sin(frameTimeCounter) * 0.02;
    gl_FragColor = albedo * light * color + wobble;
}
