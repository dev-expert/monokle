import { ResourceMapType } from '../../models/appstate';
import { getK8sResources, isKustomizationFile, linkResources } from './resource';
import path from 'path';
import log from 'loglevel';
import { FileEntry } from '../../models/fileentry';
import { K8sResource, ResourceRefType } from '../../models/k8sresource';

function linkParentKustomization(fileEntry: FileEntry, kustomization: K8sResource, resourceMap: ResourceMapType) {
  fileEntry.resourceIds?.forEach(e => {
    const target = resourceMap[e];
    if (target) {
      linkResources(kustomization, target, ResourceRefType.KustomizationResource, ResourceRefType.KustomizationParent);
    }
  });
}

function processKustomizationResource(fileMap: Map<string, FileEntry>, kustomization: K8sResource, resource: string, resourceMap: ResourceMapType) {
  const fileEntry = fileMap.get(path.join(path.parse(kustomization.path).dir, resource));
  if (fileEntry) {
    if (fileEntry.children) {
      // resource is folder -> find contained kustomizations and link...
      fileEntry.children.filter(
        childFileEntry => isKustomizationFile(childFileEntry, resourceMap),
      ).forEach(childFileEntry => {
        linkParentKustomization(childFileEntry, kustomization, resourceMap);
      });
    } else {
      // resource is file -> check for contained resources
      linkParentKustomization(fileEntry, kustomization, resourceMap);
    }
  }
}

export function processKustomizations(resourceMap: ResourceMapType, fileMap: Map<string, FileEntry>) {
  getK8sResources(resourceMap, 'Kustomization')
    .filter(k => k.content.resources || k.content.bases || k.content.patchesStrategicMerge)
    .forEach(kustomization => {
      var resources = kustomization.content.resources || [];
      if (kustomization.content.bases) {
        resources = resources.concat(kustomization.content.bases);
      }

      resources.forEach((r: string) => {
        processKustomizationResource(fileMap, kustomization, r, resourceMap);
      });

      kustomization.content.patchesStrategicMerge?.forEach((e: string) => {
        const fileEntry = fileMap.get(path.join(path.parse(kustomization.path).dir, e));
        if (fileEntry) {
          fileEntry.resourceIds?.forEach(id => resourceMap[id].name = 'Patch: ' + resourceMap[id].name);
        } else {
          log.warn('Failed to find patchesStrategicMerge ' + e + ' in kustomization ' + kustomization.path);
        }
      });
    });
}