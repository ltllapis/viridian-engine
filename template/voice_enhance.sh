#!/bin/bash
# Clean up a voice recording (Vince's own voice or any VO): bash voice_enhance.sh in.(m4a|wav|mp3) out.wav
# Noise reduction, rumble cut, warmth, de-ess, gentle compression, loudness. Free, all ffmpeg.
ffmpeg -y -v error -i "$1" -af "highpass=f=80,afftdn=nf=-28:nr=12,equalizer=f=120:t=q:w=1:g=2,equalizer=f=6500:t=q:w=2:g=-3,acompressor=threshold=-21dB:ratio=3:attack=12:release=160:makeup=3,loudnorm=I=-16:TP=-1.5:LRA=9" -ar 44100 -ac 1 "$2"
