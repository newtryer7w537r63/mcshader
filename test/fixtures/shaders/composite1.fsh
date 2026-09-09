#version 120

#define SHADOWS // Enable shadows [false true]
#define SHADOW_DISTANCE 32.0 // Shadow render distance [16.0 32.0 64.0 128.0]

uniform sampler2D colortex0;
uniform sampler2D depthtex0;
uniform sampler2DShadow shadowtex0;
uniform mat4 shadowModelView;
uniform mat4 shadowProjection;
uniform mat4 gbufferModelViewInverse;
uniform mat4 gbufferProjectionInverse;
uniform vec3 shadowLightPosition;

varying vec2 texcoord;

/* RENDERTARGETS: 0 */
void main() {
    vec3 color = texture2D(colortex0, texcoord).rgb;
    float depth = texture2D(depthtex0, texcoord).r;

#ifdef SHADOWS
    float shadow = shadow2D(shadowtex0, vec3(texcoord, depth)).r;
    color *= mix(0.3, 1.0, shadow);
#endif

    gl_FragData[0] = vec4(color, 1.0);
}
