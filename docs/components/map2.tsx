import { PolygonLayer, RasterLayer, Scene, Source } from '@antv/l7';
import { Button, message, Radio, Spin } from 'antd';
import React, { useEffect } from 'react';
// @ts-ignore
import { SAMGeo } from 'sam.js';
// @ts-ignore
import { Map } from '@antv/l7-maps';

import { useSetState } from 'ahooks';
import { EMBEDDING_URL } from '../config';
import { ISamState } from '../typing';
import {
  annotion,
  googleSatellite,
  locations,
  selectionType,
} from './contants';
import './index.less';
import { RightPanel } from './leftpanel';

const MODEL_DIR = '../model/sam_onnx_example.onnx';

const initState = {
  samModel: null,
  currentScene: null,
  currentSource: null,
  mapClick: null,
  loading: false,
  borderLayer: null,
  eventType: 'click',
  collapsed: true,
  satelliteData: [],
};

export default () => {
  const mapZoom: number = 17;
  const [samInfo, setSamState] = useSetState<ISamState>(initState);

  const onLocationChange = (item) => {
    const coord = locations.find((l) => l.name === item.target.value);
    if (coord)
      samInfo.currentScene?.setCenter(coord!.coord as [number, number]);
    samInfo.currentScene?.setZoom((coord!.zoom as number) || 17);
  };
  // 生成 embedding 并初始化载入模型
  const generateEmbedding = async () => {
    setSamState({ loading: true });
    const tiles = samInfo.currentSource?.tileset?.currentTiles;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    tiles?.forEach((tile: { x: number; y: number; z: number }) => {
      minX = Math.min(minX, tile.x);
      minY = Math.min(minY, tile.y);
      maxX = Math.max(maxX, tile.x);
      maxY = Math.max(maxY, tile.y);
    });
    const zoom = Math.ceil(samInfo.currentScene?.getZoom() as number);

    const canvas = document.createElement('canvas');
    canvas.width = (maxX - minX + 1) * 256;
    canvas.height = (maxY - minY + 1) * 256;
    const ctx = canvas.getContext('2d')!;
    const mapHelper = samInfo.samModel.mapHelper;
    const imageExtent = [
      ...mapHelper.tileToLngLat(minX, maxY + 1, zoom),
      ...mapHelper.tileToLngLat(maxX + 1, minY, zoom),
    ];

    // Draw each tile on the canvas

    tiles?.forEach((tile: any) => {
      if (tile) {
        ctx?.drawImage(
          tile.data,
          (tile.x - minX) * 256,
          (tile.y - minY) * 256,
          256,
          256,
        );
      }
    });

    // 设置模型的图片
    samInfo.samModel.setGeoImage(canvas.toDataURL(), {
      extent: imageExtent,
      width: canvas.width,
      height: canvas.height,
    });

    // 生成 embedding
    canvas.toBlob(async (blob) => {
      const action = EMBEDDING_URL;
      const formData = new FormData();
      formData.append('file', blob as Blob);
      const res = await (
        await fetch(action, {
          body: formData,
          method: 'POST',
        })
      ).arrayBuffer();
      samInfo.samModel.setEmbedding(res);
      // setLoading(false);
      setSamState({ loading: false });
      message.success('embedding计算完成');
    });
  };

  // 地图点击
  useEffect(() => {
    try {
      if (!samInfo.mapClick) return;
      const px = samInfo.samModel.lngLat2ImagePixel(samInfo.mapClick);

      const points = [
        {
          x: px[0],
          y: px[1],
          clickType: 1,
        },
      ];
      samInfo.samModel.predictByPoints(points).then(async (res) => {
        const polygon = await samInfo.samModel.exportGeoPolygon(res, 1);
        const image = samInfo.samModel.exportImageClip(res);
        const newData = {
          features: polygon.features,
          imageUrl: image.src,
        };
        setSamState((pre) => ({
          satelliteData: [...pre.satelliteData, newData],
        }));
      });
    } catch (error) {
      message.error('请先点击[生成 embedding] 按钮');
    }
  }, [samInfo.mapClick]);

  useEffect(() => {
    if (samInfo.borderLayer) {
      const newFeature = samInfo.satelliteData.map((item) => item.features);
      const newPolygon = {
        type: 'FeatureCollection',
        features: newFeature.flat(),
      };
      samInfo.borderLayer.setData(newPolygon);
    }
  }, [samInfo.borderLayer, samInfo.satelliteData]);

  // 初始化地图
  useEffect(() => {
    const scene = new Scene({
      id: 'map',
      map: new Map({
        center: [120.10533489408249, 30.261061158180482],
        zoom: mapZoom,
        minZoom: 3,
        style: 'blank',
      }),
    });

    const layerSource = new Source(googleSatellite, {
      parser: {
        type: 'rasterTile',
        tileSize: 256,
      },
    });
    const layer1 = new RasterLayer({
      zIndex: -2,
    }).source(layerSource);

    const layer2 = new RasterLayer({
      zIndex: -1,
    }).source(annotion, {
      parser: {
        type: 'rasterTile',
        tileSize: 256,
        zoomOffset: 0,
      },
    });

    const boundsLayer = new PolygonLayer({
      zIndex: 10,
    })
      .source({
        type: 'FeatureCollection',
        features: [],
      })
      .shape('line')
      .size(2)
      .color('#f00')
      .style({
        opacity: 1,
      });

    scene.on('loaded', () => {
      scene.addLayer(layer1);
      scene.addLayer(layer2);
      scene.addLayer(boundsLayer);
      setSamState({
        borderLayer: boundsLayer,
        currentScene: scene,
        currentSource: layerSource,
      });
      if (samInfo.eventType === 'selectend') {
        scene.enableBoxSelect(false);
      } else {
        scene.disableBoxSelect();
      }
      scene.on(samInfo.eventType, (e) => {
        const isArray = Array.isArray(e);
        const coords = !isArray ? [e.lngLat.lng, e.lngLat.lat] : e;
        setSamState({
          mapClick: coords,
        });
      });
    });
  }, [samInfo.eventType]);

  // 初始化模型

  useEffect(() => {
    const sam = new SAMGeo({
      modelUrl: MODEL_DIR,
    });
    sam.initModel().then(() => {
      setSamState({ samModel: sam });
    });
  }, []);

  return (
    <>
      <Button onClick={generateEmbedding}> 生成 embedding </Button>
      <Radio.Group
        style={{ margin: '15px' }}
        onChange={onLocationChange}
        defaultValue="A 空间"
        buttonStyle="solid"
      >
        {locations.map((item) => {
          return (
            <Radio.Button key={item.name} value={item.name}>
              {item.name}
            </Radio.Button>
          );
        })}
      </Radio.Group>
      <div className="mapContainer">
        <Spin spinning={samInfo.loading} tip={'embedding 生成中……'}>
          <div
            id="map"
            className="mapContainer__map"
            style={{ width: `calc(55vw - ${!samInfo.collapsed ? 0 : 400}px)` }}
          >
            <Radio.Group
              style={{ position: 'absolute', top: 15, left: 15, zIndex: 100 }}
              onChange={(event) => {
                setSamState({ eventType: event.target.value });
              }}
              value={samInfo.eventType}
              size="small"
              buttonStyle="solid"
            >
              {selectionType.map((item) => {
                return (
                  <Radio.Button
                    key={item.value}
                    value={item.value}
                    // disabled={item?.disable}
                  >
                    {item.label}
                  </Radio.Button>
                );
              })}
            </Radio.Group>
          </div>
        </Spin>
        <RightPanel samInfo={samInfo} setSamState={setSamState} />
      </div>
    </>
  );
};